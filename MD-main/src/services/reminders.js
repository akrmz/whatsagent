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
const MIN_EVERY = 10 * 60 * 1000;

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

/** Minutes and seconds of the current time of day in a time zone. */
function clockIn(timeZone, now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), seconds: Number(parts.second) };
}

/** "18:30", "6:30pm", "9am" → minutes after midnight, or null. */
function parseClock(text) {
  const m = String(text).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/**
 * Understands what .remind accepts in front of the text:
 *   10m … · 1h30m … · at 18:30 … · tomorrow at 9am … · every 1d … · every day at 08:00 …
 * @returns {{ ms: number, every: number, rest: string } | null}  ms = time until the first reminder
 */
function parseWhen(text, timeZone, now = Date.now()) {
  let rest = String(text || "").trim();
  let every = 0;
  const ev = rest.match(/^every\s+/i);
  if (ev) {
    rest = rest.slice(ev[0].length);
    const bare = rest.match(/^(day|daily|week|weekly|hour|hourly)\b\s*/i);
    if (bare) {
      every = { day: UNITS.d, daily: UNITS.d, week: UNITS.w, weekly: UNITS.w, hour: UNITS.h, hourly: UNITS.h }[bare[1].toLowerCase()];
      rest = rest.slice(bare[0].length);
    } else {
      const d = parseDuration(rest);
      if (!d) return null;
      every = d.ms;
      rest = d.rest;
    }
  }
  const at = rest.match(/^(tomorrow\s+)?(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?=\s|$)\s*/i);
  // A clock time needs "at", "tomorrow", "every" or a colon, so "10 apples" is not 10 o'clock.
  const clock = at && (at[1] || /^(at\s|tomorrow)/i.test(at[0]) || every || at[2].includes(":")) ? parseClock(at[2]) : null;
  if (clock !== null) {
    const { minutes, seconds } = clockIn(timeZone, now);
    let delta = clock - minutes;
    if (delta <= 0) delta += 1440;
    if (at[1] && delta < 1440 && clock > minutes) delta += 1440; // "tomorrow" even if later today
    return { ms: delta * 60000 - seconds * 1000, every, rest: rest.slice(at[0].length).trim() };
  }
  if (every) return { ms: every, every, rest: rest.trim() };
  const d = parseDuration(rest);
  return d ? { ms: d.ms, every: 0, rest: d.rest } : null;
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

function add(state, { chat, sender, text, ms, every = 0, now = Date.now() }) {
  if (ms < MIN_MS) throw new UserError("The shortest reminder is 10 seconds.");
  if (ms > MAX_MS) throw new UserError("The longest reminder is 60 days.");
  if (every && (every < MIN_EVERY || every > MAX_MS)) throw new UserError("A repeating reminder must repeat every 10 minutes to 60 days.");
  const body = String(text || "").trim().slice(0, MAX_TEXT);
  if (!body) throw new UserError("What should I remind you about?");
  return store(state).update((d) => {
    if (d.items.filter((r) => r.sender === sender).length >= MAX_PER_USER) {
      throw new UserError(`You already have ${MAX_PER_USER} reminders. Delete one first.`);
    }
    const item = { id: ++d.seq, chat, sender, text: body, due: now + ms, created: now, attempts: 0, ...(every ? { every } : {}) };
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
      const repeat = r.every ? `\n\n_🔁 every ${formatDuration(r.every)} · stop: .remind del ${r.id}_` : "";
      await sock.sendMessage(r.chat, { text: `⏰ *Reminder* for @${user}\n\n${r.text}${late}${repeat}`, mentions: [r.sender] });
      if (r.every) {
        // Next time in the future (missed repeats while offline are not all sent).
        s.update(() => {
          r.due += Math.max(1, Math.ceil((now - r.due + 1) / r.every)) * r.every;
          r.attempts = 0;
        });
      } else {
        s.update((d) => (d.items = d.items.filter((x) => x.id !== r.id)));
      }
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
  parseWhen,
  parseClock,
  formatDuration,
  add,
  listFor,
  remove,
  clearFor,
  deliverDue,
  startReminderLoop,
  MAX_PER_USER,
};
