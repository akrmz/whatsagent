"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { UserError } = require("../core/errors");
const { hasSession } = require("../core/connection");
const { normalizePhone } = require("./phones");

/**
 * More WhatsApp numbers, each its own bot (.numbers): the main bot starts every extra number as
 * a separate process running this same code, with its own data and session under
 * instances/<number>/, so one number's listings, clients, settings, crash or ban never touch
 * another's. The owner adds one from their private chat; its pairing code comes back there over
 * the process channel (never through the logs). Extra numbers start with the main bot, are
 * restarted if they stop unexpectedly (at most 5 times in 10 minutes), and can't add numbers.
 *   DATA_DIR/instances.json { items: { [number]: { number, created, enabled } } }
 */

const MAX_NUMBERS = 5;
const RESTARTS = { max: 5, windowMs: 10 * 60 * 1000 };
const PAIRING_WAIT_MS = 90 * 1000;
const ROOT_DIR = path.resolve(__dirname, "..", ".."); // MD-main
const INDEX = path.join(ROOT_DIR, "index.js");

const isExtra = () => Boolean(process.env.BOT_INSTANCE);
const store = (state) => state.store("instances", { items: {} });
const list = (state) => Object.values(store(state).data.items).sort((a, b) => a.created - b.created);
const get = (state, number) => store(state).data.items[number] || null;
const baseDir = (config) => path.resolve(config.paths.data, "..", "instances");
const dirOf = (config, number) => path.join(baseDir(config), String(number).replace(/\D/g, ""));

/** Running children: number → { proc, state, started, restarts: [times], stopping, code, waiters } */
const running = new Map();

let spawner = (env) => spawn(process.execPath, [INDEX], { cwd: ROOT_DIR, env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
/** For tests: what starts a number's process (no WhatsApp in tests). */
const setSpawner = (fn) => (spawner = fn || ((env) => spawn(process.execPath, [INDEX], { cwd: ROOT_DIR, env, stdio: ["ignore", "inherit", "inherit", "ipc"] })));

/** The environment of a number's process: the main bot's, with its own folders and number. */
function envFor(config, number) {
  const dir = dirOf(config, number);
  return {
    ...process.env,
    BOT_INSTANCE: number,
    DATA_DIR: path.join(dir, "data"),
    SESSION_DIR: path.join(dir, "session"),
    TMP_DIR: path.join(dir, "tmp"),
    HEALTH_PORT: "0", // the main bot keeps the health port; it knows each number's state
    PAIRING_NUMBER: number, // used only until the number is linked
  };
}

const ownerChat = (app) => `${app.config.owners.numbers[0]}@s.whatsapp.net`;
const tell = (app, text) => (app.sock ? app.sock.sendMessage(ownerChat(app), { text }).catch(() => {}) : undefined);

function onMessage(app, number, msg) {
  const r = running.get(number);
  if (!r || !msg || typeof msg !== "object") return;
  if (msg.type === "pairing-code" && /^[A-Z0-9-]{8,12}$/i.test(String(msg.code || ""))) {
    r.code = msg.code;
    r.state = "pairing";
    const waiters = r.waiters.splice(0);
    if (waiters.length) waiters.forEach((w) => w(msg.code));
    else tell(app, pairingText(number, msg.code)); // a new code after a reconnect
  } else if (msg.type === "state" && ["open", "disconnected", "logged-out", "forbidden"].includes(msg.state)) {
    const was = r.state;
    r.state = msg.state;
    if (msg.state === "open") r.code = null;
    if (msg.state === "open" && was === "pairing") tell(app, `✅ الرقم +${number} اتربط وبقى شغال كبوت لوحده.\nكلّمه من رقمك عشان تديره (أوامره زي البوت الأساسي)، أو ${app.config.bot.prefix}numbers`);
    if (msg.state === "logged-out") tell(app, `⚠️ الرقم +${number} اتفصل من واتساب (Logged out). لربطه تاني: ${app.config.bot.prefix}numbers code ${number}`);
    if (msg.state === "forbidden") tell(app, `⚠️ واتساب رفض الاتصال بالرقم +${number} (ممكن يكون عليه قيود).`);
  }
}

const pairingText = (number, code) =>
  `🔗 *كود ربط الرقم +${number}:*  ${code}\n\nعلى موبايل الرقم ده: واتساب ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز ← "الربط برقم الهاتف بدلاً من ذلك" ← اكتب الكود.\nالكود ده سري: ما تبعتهوش لحد.`;

function onExit(app, number) {
  const r = running.get(number);
  if (!r) return;
  running.delete(number);
  if (r.stopping || !get(app.state, number)?.enabled) return;
  // Stopped on its own: started again, unless it keeps stopping.
  const now = Date.now();
  const recent = [...r.restarts.filter((t) => now - t < RESTARTS.windowMs), now];
  if (recent.length > RESTARTS.max) {
    app.log.error({ number: `…${number.slice(-4)}` }, "extra number keeps stopping; not restarting it");
    tell(app, `⚠️ الرقم +${number} وقف ${RESTARTS.max} مرات في 10 دقايق، ومش هيتشغل تاني لوحده. شوف سجل السيرفر، وبعدين: ${app.config.bot.prefix}numbers start ${number}`);
    return;
  }
  setTimeout(() => start(app, number, { restarts: recent }), Math.min(60000, 2000 * recent.length)).unref?.();
}

/** Starts a number's process (if it isn't running). */
function start(app, number, { restarts = [] } = {}) {
  if (isExtra()) throw new UserError("This is an extra number; manage numbers from the main bot.");
  if (running.has(number)) return running.get(number);
  const dir = dirOf(app.config, number);
  for (const sub of ["data", "session", "tmp"]) fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 });
  const proc = spawner(envFor(app.config, number));
  const r = { proc, state: hasSession(path.join(dir, "session")) ? "starting" : "pairing", started: Date.now(), restarts, stopping: false, code: null, waiters: [] };
  running.set(number, r);
  proc.on("message", (m) => onMessage(app, number, m));
  proc.on("exit", () => onExit(app, number));
  proc.on("error", (err) => app.log.warn({ err: err.message }, "extra number process error"));
  return r;
}

/** Stops a number's process (SIGTERM, then SIGKILL after 10 s). */
function stop(number) {
  const r = running.get(number);
  if (!r) return false;
  r.stopping = true;
  r.proc.kill("SIGTERM");
  setTimeout(() => r.proc.exitCode === null && !r.proc.killed && r.proc.kill("SIGKILL"), 10000).unref?.();
  return true;
}

/** Stops (waiting for it to exit, at most 12 s) and starts again. */
async function restart(app, number) {
  const r = running.get(number);
  if (r) {
    const exited = new Promise((resolve) => {
      r.proc.once("exit", resolve);
      setTimeout(resolve, 12000).unref?.();
    });
    stop(number);
    await exited;
    running.delete(number);
  }
  return start(app, number);
}

/** The next pairing code of a running number (or the one it already has). */
function nextCode(number, waitMs = PAIRING_WAIT_MS) {
  const r = running.get(number);
  if (!r) return Promise.resolve(null);
  if (r.code) return Promise.resolve(r.code);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs);
    timer.unref?.();
    r.waiters.push((code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** A number written by the owner, as digits with the country code. */
function numberFrom(app, text) {
  const n = normalizePhone(String(text || ""), app.config.owners.numbers[0]);
  if (!n) throw new UserError("Write the number with its country code, e.g. .numbers add 201198765432 (or 0119 876 5432).");
  return n;
}

/** Adds and starts a number. @returns {Promise<{ number, code: string|null }>} */
async function add(app, text, by, now = Date.now()) {
  if (isExtra()) throw new UserError("This is an extra number; add numbers from the main bot.");
  const number = numberFrom(app, text);
  const me = String(app.sock?.user?.id || "").split(/[:@]/)[0];
  if (number === me) throw new UserError("That's this bot's own number.");
  if (get(app.state, number)) throw new UserError(`+${number} is already added (.numbers).`);
  if (list(app.state).length >= MAX_NUMBERS) throw new UserError(`At most ${MAX_NUMBERS} extra numbers.`);
  store(app.state).update((d) => (d.items[number] = { number, created: now, enabled: true, by }));
  start(app, number);
  return { number, code: await nextCode(number) };
}

/** Stops it and moves its folder aside (nothing is deleted). @returns {string} where it went */
function remove(app, number) {
  if (!get(app.state, number)) throw new UserError(`+${number} isn't one of the numbers (.numbers).`);
  store(app.state).update((d) => delete d.items[number]);
  stop(number);
  const dir = dirOf(app.config, number);
  if (!fs.existsSync(dir)) return null;
  const aside = `${dir}.removed-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100000}`;
  fs.renameSync(dir, aside);
  return aside;
}

function setEnabled(app, number, enabled) {
  if (!get(app.state, number)) throw new UserError(`+${number} isn't one of the numbers (.numbers).`);
  store(app.state).update((d) => (d.items[number].enabled = enabled));
}

/** "connected", "waiting for pairing", "starting", "stopped" … for the list. */
function status(app, number) {
  const r = running.get(number);
  const item = get(app.state, number);
  if (!r) return item?.enabled ? "⏹️ stopped (it stopped too often, or is starting)" : "⏸️ stopped";
  return { open: "✅ connected", pairing: "🔗 waiting for pairing", starting: "⏳ starting", disconnected: "🔄 reconnecting", "logged-out": "⚠️ logged out", forbidden: "⛔ refused by WhatsApp" }[r.state] || r.state;
}

/** With the main bot: every enabled number starts; on shutdown, all stop. */
function startAll(app) {
  if (isExtra()) return () => {};
  for (const item of list(app.state).filter((i) => i.enabled)) {
    try {
      start(app, item.number);
    } catch (err) {
      app.log.warn({ err: err.message }, "extra number not started");
    }
  }
  return () => [...running.keys()].forEach(stop);
}

module.exports = { add, remove, start, stop, restart, setEnabled, status, list, get, nextCode, startAll, envFor, dirOf, numberFrom, pairingText, setSpawner, isExtra, running, MAX_NUMBERS };
