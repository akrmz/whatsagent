"use strict";

const { UserError } = require("../core/errors");

/**
 * .remind — reminders stored in DATA_DIR/reminders.json, so they survive restarts.
 * A timer checks every 15 s and sends due reminders while WhatsApp is connected;
 * reminders that became due while the bot was offline are sent (marked late) on reconnect.
 */

const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
const UNIT_ALIASES = {
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  d: "d", day: "d", days: "d",
  w: "w", week: "w", weeks: "w",
};
const MIN_MS = 10 * 1000;
const MAX_MS = 60 * UNITS.d;
const MAX_PER_USER = 10;
const MAX_TEXT = 500;
const TICK_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Parses a leading duration like "10m", "1h30m", "2 days", "1h 15min".
 * @returns {{ ms: number, rest: string } | null}
 */
function parseDuration(text) {
  const re = /^\s*(\d{1,4}(?:\.\d+)?)\s*([a-z]+)(?![a-z])/i;
  let rest = String(text || "");
  let ms = 0;
  let matched = false;
  for (let m = rest.match(re); m; m = rest.match(re)) {
    const unit = UNIT_ALIASES[m[2].toLowerCase()];
    if (!unit) break;
    ms += Number(m[1]) * UNITS[unit];
    rest = rest.slice(m[0].length);
    matched = true;
  }
  return matched ? { ms: Math.round(ms), rest: rest.trim() } : null;
}

function formatDuration(ms) {
  const parts = [];
  let left = Math.max(0, Math.round(ms / 1000));
  for (const [unit, secs] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]) {
    const n = Math.floor(left / secs);
    if (n) parts.push(`${n}${unit}`);
    left -= n * secs;
  }
  return parts.slice(0, 2).join(" ") || "0s";
}

const store = (state) => state.store("reminders", { seq: 0, items: [] });

function add(state, { chat, sender, text, ms, now = Date.now() }) {
  if (ms < MIN_MS) throw new UserError("The shortest reminder is 10 seconds.");
  if (ms > MAX_MS) throw new UserError("The longest reminder is 60 days.");
  const body = String(text || "").trim().slice(0, MAX_TEXT);
  if (!body) throw new UserError("What should I remind you about?");
  return store(state).update((d) => {
    if (d.items.filter((r) => r.sender === sender).length >= MAX_PER_USER) {
      throw new UserError(`You already have ${MAX_PER_USER} reminders. Delete one first.`);
    }
    const item = { id: ++d.seq, chat, sender, text: body, due: now + ms, created: now, attempts: 0 };
    d.items.push(item);
    return item;
  });
}

const listFor = (state, sender) => store(state).data.items.filter((r) => r.sender === sender).sort((a, b) => a.due - b.due);

function remove(state, sender, id) {
  return store(state).update((d) => {
    const i = d.items.findIndex((r) => r.id === id && r.sender === sender);
    if (i === -1) return false;
    d.items.splice(i, 1);
    return true;
  });
}

function clearFor(state, sender) {
  return store(state).update((d) => {
    const before = d.items.length;
    d.items = d.items.filter((r) => r.sender !== sender);
    return before - d.items.length;
  });
}

/** Sends every due reminder. Exported for tests; the timer calls it. */
async function deliverDue(app, now = Date.now()) {
  const sock = app.sock;
  if (!sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const due = s.data.items.filter((r) => r.due <= now);
  let sent = 0;
  for (const r of due) {
    const late = now - r.due > 2 * 60 * 1000 ? `\n_(late by ${formatDuration(now - r.due)} — the bot was offline)_` : "";
    const user = r.sender.split("@")[0].split(":")[0];
    try {
      await sock.sendMessage(r.chat, { text: `⏰ *Reminder* for @${user}\n\n${r.text}${late}`, mentions: [r.sender] });
      s.update((d) => (d.items = d.items.filter((x) => x.id !== r.id)));
      sent++;
    } catch (err) {
      s.update(() => (r.attempts = (r.attempts || 0) + 1));
      if (r.attempts >= MAX_ATTEMPTS) s.update((d) => (d.items = d.items.filter((x) => x.id !== r.id)));
      app.log.warn({ err: err.message, attempts: r.attempts }, "could not send a reminder");
    }
  }
  return sent;
}

function startReminderLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await deliverDue(app);
    } catch (err) {
      app.log.error({ err }, "reminder loop failed");
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  parseDuration,
  formatDuration,
  add,
  listFor,
  remove,
  clearFor,
  deliverDue,
  startReminderLoop,
  MAX_PER_USER,
};
