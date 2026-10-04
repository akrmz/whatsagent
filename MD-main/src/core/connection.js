"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} = require("@whiskeysockets/baileys");
const { LRU } = require("./lru");
const { maskJid } = require("../logger");

const SESSION_POLL_MS = 10000;
const MAX_BACKOFF_MS = 60000;

function hasSession(dir) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(dir, "creds.json"), "utf8"));
    return Boolean(creds.registered || creds.me);
  } catch {
    return false;
  }
}

/**
 * Owns the single WhatsApp socket:
 *  - exponential backoff with jitter between reconnects (reset after a successful open)
 *  - "restart required" (515) reconnects immediately
 *  - logged out (401): the session folder is moved aside (never deleted) and the bot waits
 *    for a new session to appear (pairing service or PAIRING_NUMBER)
 *  - with no session it waits and checks SESSION_DIR every 10 s, so a session saved by the
 *    pairing service is picked up without restarting
 */
function createConnection(app, dispatcher, baileysLogger) {
  const { config, log } = app;
  let sock = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;
  let waitingLogged = false;

  const setState = (s) => {
    app.health.state = s;
  };

  function schedule(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  function backoff() {
    const ms = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
    attempt += 1;
    return ms;
  }

  function teardown() {
    if (!sock) return;
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch {
      /* already closed */
    }
    sock = null;
    app.sock = null;
  }

  function trackSends(s) {
    const original = s.sendMessage.bind(s);
    s.sendMessage = async (...args) => {
      const sent = await original(...args);
      if (sent?.key?.id) app.sentIds.set(sent.key.id, true);
      return sent;
    };
  }

  function handleLoggedOut() {
    teardown();
    const dir = config.paths.session;
    const aside = `${dir}.loggedout-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      if (fs.existsSync(dir)) fs.renameSync(dir, aside);
      log.error(
        { movedTo: aside },
        "WhatsApp logged this bot out (device removed or session revoked). The old session was moved aside. " +
          "Pair again (pairing service or PAIRING_NUMBER in .env). The bot will start automatically once a new session exists.",
      );
    } catch (err) {
      log.error({ err: err.message }, "logged out, and the session folder could not be moved; delete it manually and pair again");
    }
    setState("logged-out");
    attempt = 0;
    schedule(connect, SESSION_POLL_MS);
  }

  async function connect() {
    if (stopped) return;
    const dir = config.paths.session;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    if (!hasSession(dir) && !config.pairingNumber) {
      if (!waitingLogged) {
        log.warn(
          { sessionDir: dir },
          "No WhatsApp session yet. Pair with the pairing service, or set PAIRING_NUMBER in .env to get a code in this log. Waiting…",
        );
        waitingLogged = true;
      }
      setState("waiting-for-session");
      schedule(connect, SESSION_POLL_MS);
      return;
    }
    waitingLogged = false;
    setState("connecting");

    let auth;
    let saveCreds;
    let version;
    try {
      ({ state: auth, saveCreds } = await useMultiFileAuthState(dir));
      ({ version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined })));
    } catch (err) {
      log.error({ err }, "could not load the session");
      schedule(connect, backoff());
      return;
    }

    teardown();
    sock = makeWASocket({
      version,
      logger: baileysLogger,
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, baileysLogger) },
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: config.bot.markOnline,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: app.store.getMessage,
      cachedGroupMetadata: app.groups.cachedGroupMetadata,
      msgRetryCounterCache: new LRU({ max: 5000, ttlMs: 10 * 60 * 1000 }),
    });
    trackSends(sock);
    app.sock = sock;
    const current = sock;
    let pairingRequested = false;

    current.ev.on("creds.update", saveCreds);
    current.ev.on("messages.upsert", (u) => dispatcher.handleUpsert(current, u));
    current.ev.on("group-participants.update", (u) => {
      app.groups.invalidate(u.id);
      dispatcher.handleEvent("group-participants.update", current, u);
    });
    current.ev.on("groups.update", (updates) => updates.forEach((g) => app.groups.invalidate(g.id)));
    current.ev.on("call", (calls) => dispatcher.handleEvent("call", current, calls));

    current.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (current !== sock) return; // stale socket

      if (qr && !auth.creds.registered && config.pairingNumber && !pairingRequested) {
        pairingRequested = true;
        try {
          const raw = await current.requestPairingCode(config.pairingNumber);
          const code = raw.match(/.{1,4}/g)?.join("-") ?? raw;
          // Printed directly (not logged) so it is never shipped to log storage.
          process.stdout.write(
            `\n  Pairing code for ${maskJid(config.pairingNumber)}:  ${code}\n` +
              "  WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead\n\n",
          );
        } catch (err) {
          log.error({ err: err.message }, "WhatsApp refused to issue a pairing code; check PAIRING_NUMBER");
        }
      }

      if (connection === "open") {
        attempt = 0;
        setState("open");
        app.identity.link(current.user?.id, current.user?.lid);
        log.info({ as: maskJid(current.user?.id) }, "connected to WhatsApp");
        return;
      }

      if (connection !== "close" || stopped) return;
      const status = lastDisconnect?.error?.output?.statusCode;
      setState("disconnected");
      if (status === DisconnectReason.loggedOut) return handleLoggedOut();
      if (status === DisconnectReason.restartRequired) {
        log.info("restart required by WhatsApp; reconnecting");
        teardown();
        return connect();
      }
      teardown();
      let delay = backoff();
      if (status === DisconnectReason.connectionReplaced) {
        delay = Math.max(delay, MAX_BACKOFF_MS);
        log.error("Another client opened this session (connection replaced). Make sure only one bot instance runs.");
      } else if (status === DisconnectReason.forbidden) {
        delay = 5 * 60 * 1000;
        log.error("WhatsApp refused the connection (403). The account may be restricted.");
      } else {
        log.warn({ status, retryInMs: delay }, "connection closed; reconnecting");
      }
      schedule(connect, delay);
      return undefined;
    });
  }

  return {
    start: () => connect(),
    stop() {
      stopped = true;
      clearTimeout(timer);
      teardown();
    },
    current: () => sock,
  };
}

module.exports = { createConnection, hasSession };
