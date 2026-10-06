"use strict";

const { parseClock } = require("./reminders");

/**
 * Daily group open/close (.gcschedule): at the "close" time only admins can send
 * messages, at the "open" time everyone can again. Times use TIMEZONE.
 * Stored in DATA_DIR/group-schedule.json as { [group]: { close: "23:00", open: "08:00", done: { close: "2026-10-06" } } }.
 * If the bot was offline at the time, the change is applied when it comes back
 * (up to 3 hours late), once per day.
 */

const TICK_MS = 30 * 1000;
const LATE_LIMIT_MIN = 180;

const store = (state) => state.store("group-schedule", {});

function zoneNow(timeZone, now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function set(state, chat, action, timeText, timeZone, now = Date.now()) {
  const minutes = parseClock(timeText);
  if (minutes === null) return null;
  const today = zoneNow(timeZone, now);
  store(state).update((d) => {
    d[chat] ||= { done: {} };
    d[chat].done ||= {};
    d[chat][action] = hhmm(minutes);
    // Starts at the next occurrence: a time already passed today first runs tomorrow.
    if (today.minutes >= minutes) d[chat].done[action] = today.day;
    else delete d[chat].done[action];
  });
  return hhmm(minutes);
}

function clear(state, chat, action) {
  return store(state).update((d) => {
    if (!d[chat]) return false;
    if (action) delete d[chat][action];
    if (!action || (!d[chat].open && !d[chat].close)) delete d[chat];
    return true;
  });
}

const get = (state, chat) => store(state).data[chat] || null;

/** Which scheduled changes are due now. Exported for tests. */
function dueActions(entry, timeZone, now = Date.now()) {
  const { day, minutes } = zoneNow(timeZone, now);
  const out = [];
  for (const action of ["close", "open"]) {
    if (!entry[action] || entry.done?.[action] === day) continue;
    const at = parseClock(entry[action]);
    const late = minutes - at;
    if (late >= 0 && late <= LATE_LIMIT_MIN) out.push({ action, day });
  }
  return out;
}

async function runDue(app, now = Date.now()) {
  const sock = app.sock;
  if (!sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  let applied = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    for (const { action, day } of dueActions(entry, app.config.bot.timezone, now)) {
      s.update(() => {
        entry.done ||= {};
        entry.done[action] = day; // once per day, even if it fails (no retry storm)
      });
      try {
        await sock.groupSettingUpdate(chat, action === "close" ? "announcement" : "not_announcement");
        const other = action === "close" ? entry.open : entry.close;
        const text = action === "close" ? `🔒 The group is now closed: only admins can send messages${other ? ` until ${other}` : ""}.` : `🔓 The group is open again${other ? ` (closes at ${other})` : ""}.`;
        await sock.sendMessage(chat, { text });
        applied++;
      } catch (err) {
        app.log.warn({ err: err.message, action }, "scheduled group open/close failed (is the bot still an admin?)");
      }
    }
  }
  return applied;
}

function startGroupScheduleLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "group schedule loop failed");
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { set, clear, get, dueActions, runDue, startGroupScheduleLoop, zoneNow };
