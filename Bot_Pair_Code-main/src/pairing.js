import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from "@whiskeysockets/baileys";
import { deliverLocal, deliverWhatsApp } from "./delivery.js";
import { maskNumber } from "./logger.js";

export class BusyError extends Error {}

const FINISHED_JOB_TTL_MS = 15 * 60 * 1000;
const MAX_JOBS = 200;
const MAX_RESTARTS = 3;
const FLUSH_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs pairing sessions. Every session is a short-lived Baileys socket in its own
 * temporary folder. The socket is always closed and the folder always deleted when
 * the session ends (delivered, failed or timed out).
 *
 * `socketFactory` and `fetchVersion` exist so tests can run without contacting WhatsApp or GitHub.
 */
export function createPairingManager({
  config,
  logger,
  socketFactory = makeWASocket,
  fetchVersion = fetchLatestBaileysVersion,
}) {
  const jobs = new Map();
  const activeNumbers = new Set();
  let active = 0;
  const baileysLogger = logger.child({ module: "baileys" });
  baileysLogger.level = "silent";

  function pruneJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.finishedAt && now - job.finishedAt > FINISHED_JOB_TTL_MS) jobs.delete(id);
    }
    while (jobs.size > MAX_JOBS) {
      const oldestFinished = [...jobs.values()].find((j) => j.finishedAt);
      if (!oldestFinished) break;
      jobs.delete(oldestFinished.id);
    }
  }

  function publicStatus(job) {
    return {
      id: job.id,
      mode: job.mode,
      state: job.state,
      qr: job.state === "waiting" ? job.qr : undefined,
      message: job.message,
    };
  }

  async function start({ mode, number }) {
    pruneJobs();
    if (active >= config.maxConcurrent) {
      throw new BusyError("The server is busy with other pairings. Try again in a few minutes.");
    }
    if (number && activeNumbers.has(number)) {
      throw new BusyError("A pairing for this number is already in progress.");
    }

    active += 1;
    if (number) activeNumbers.add(number);
    fs.mkdirSync(config.workDir, { recursive: true, mode: 0o700 });
    const job = {
      id: randomUUID(),
      mode,
      number,
      state: "starting",
      dir: fs.mkdtempSync(path.join(config.workDir, "job-")),
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    const log = logger.child({ job: job.id, mode, number: number ? maskNumber(number) : undefined });

    let resolveFirst;
    let rejectFirst;
    const first = new Promise((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    run(job, log, resolveFirst, rejectFirst).catch((err) => {
      log.error({ err }, "pairing crashed");
    });
    return first;
  }

  async function run(job, log, resolveFirst, rejectFirst) {
    let sock;
    let finished = false;
    let artifactSent = false;
    let restarts = 0;

    const finish = async (state, message, err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      job.state = state;
      job.message = message;
      job.finishedAt = Date.now();
      try {
        sock?.ev.removeAllListeners();
        sock?.end(undefined);
      } catch {
        /* socket already closed */
      }
      fs.rmSync(job.dir, { recursive: true, force: true });
      active -= 1;
      if (job.number) activeNumbers.delete(job.number);
      if (!artifactSent) {
        const publicErr = new Error(message, { cause: err });
        publicErr.publicMessage = message;
        rejectFirst(publicErr);
      }
      if (state === "delivered") log.info("pairing finished");
      else log.warn({ state, reason: err?.message || message }, "pairing ended without delivery");
    };

    const timer = setTimeout(
      () => finish("expired", "Timed out waiting for the code to be entered."),
      config.timeoutSeconds * 1000,
    );

    let state;
    let saveCreds;
    let version;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(job.dir));
      ({ version } = await fetchVersion().catch(() => ({ version: undefined })));
    } catch (err) {
      await finish("failed", "Internal error while preparing the session.", err);
      return;
    }

    const onOpen = async () => {
      job.state = "linked";
      log.info("account linked; delivering session");
      try {
        await saveCreds();
        await sleep(FLUSH_DELAY_MS); // let pending key writes reach disk
        if (config.delivery === "whatsapp") {
          await deliverWhatsApp(sock, job.dir);
          await finish("delivered", "Linked. creds.json was sent to your own WhatsApp chat.");
        } else {
          const out = deliverLocal(job.dir, config.sessionOutputDir, {
            overwrite: config.overwriteSession,
          });
          log.info({ path: out.path, sidecar: out.sidecar }, "session saved");
          await finish(
            "delivered",
            out.sidecar
              ? "Linked. An existing session was kept; the new one was saved next to it. See the server log."
              : "Linked. The session was saved on the server. Restart the bot.",
          );
        }
      } catch (err) {
        await finish("failed", "Linked, but saving the session failed. See the server log.", err);
      }
    };

    const connect = () => {
      sock?.ev.removeAllListeners();
      sock = socketFactory({
        version,
        logger: baileysLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        browser: Browsers.windows("Chrome"),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
      });

      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", async (update) => {
        if (finished) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr && job.mode === "qr") {
          job.qr = await QRCode.toDataURL(qr, { margin: 1, errorCorrectionLevel: "M" });
          job.state = "waiting";
          if (!artifactSent) {
            artifactSent = true;
            resolveFirst({ id: job.id, qr: job.qr });
          }
        } else if (qr && job.mode === "code" && !artifactSent && !state.creds.registered) {
          try {
            const raw = await sock.requestPairingCode(job.number);
            job.state = "waiting";
            artifactSent = true;
            resolveFirst({ id: job.id, code: raw.match(/.{1,4}/g)?.join("-") ?? raw });
          } catch (err) {
            await finish("failed", "WhatsApp refused to issue a pairing code. Check the number.", err);
          }
        }

        if (connection === "open") {
          await onOpen();
        } else if (connection === "close") {
          const status = lastDisconnect?.error?.output?.statusCode;
          if (status === DisconnectReason.restartRequired && restarts < MAX_RESTARTS) {
            restarts += 1;
            log.info({ restarts }, "restart required after pairing; reconnecting");
            connect();
            return;
          }
          await finish("failed", `Connection closed (code ${status ?? "unknown"}).`, lastDisconnect?.error);
        }
      });
    };

    try {
      connect();
    } catch (err) {
      await finish("failed", "Could not open a WhatsApp connection.", err);
    }
  }

  function status(id) {
    const job = jobs.get(id);
    return job ? publicStatus(job) : null;
  }

  return {
    start,
    status,
    activeCount: () => active,
  };
}
