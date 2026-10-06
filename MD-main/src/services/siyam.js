"use strict";

const { toHijri, MONTHS_AR } = require("./hijri");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * Sunnah fasting days and an evening reminder for the next day (.autosiyam):
 * Mondays and Thursdays, the white days (13–15 of each Hijri month), Arafah (9 Dhul-Hijjah),
 * Tasu'a and Ashura (9–10 Muharram) and the six days of Shawwal (reminded on 2 Shawwal).
 * Never on days when fasting is not allowed: the two Eids and the days of Tashreeq
 * (11–13 Dhul-Hijjah), and nothing in Ramadan (the whole month is fasted anyway).
 * Hijri dates: Umm al-Qura (offline); where months follow moon sighting they can differ by a day.
 * Stored in DATA_DIR/siyam.json as { [chat]: { time: "20:00", weekly: true, last: "2026-10-06" } }.
 */

const DEFAULT_TIME = "20:00";
const LATE_LIMIT_MIN = 180;
const RETRY_MS = 10 * 60 * 1000;
const MAX_CHATS = 300;
const DAY = 86400 * 1000;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const WEEKDAYS_AR = { Sun: "الأحد", Mon: "الاثنين", Tue: "الثلاثاء", Wed: "الأربعاء", Thu: "الخميس", Fri: "الجمعة", Sat: "السبت" };

const weekday = (date, timeZone) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);

/**
 * Why a day is a sunnah fast.
 * @returns {{ forbidden: boolean, reasons: string[], hijri: object, weekday: string }}
 */
function fastsOn(date, timeZone, { weekly = true } = {}) {
  const h = toHijri(date, timeZone);
  const wd = weekday(date, timeZone);
  const base = { hijri: h, weekday: WEEKDAYS_AR[wd], reasons: [] };
  const eid = (h.month === 10 && h.day === 1) || (h.month === 12 && h.day === 10);
  const tashreeq = h.month === 12 && h.day >= 11 && h.day <= 13;
  if (eid || tashreeq) return { ...base, forbidden: true, why: eid ? "يوم عيد" : "من أيام التشريق" };
  if (h.month === 9) return { ...base, forbidden: false, ramadan: true };
  const reasons = [];
  if (h.month === 12 && h.day === 9) reasons.push("🕋 يوم عرفة");
  if (h.month === 1 && h.day === 9) reasons.push("تاسوعاء (يُصام مع عاشوراء)");
  if (h.month === 1 && h.day === 10) reasons.push("يوم عاشوراء");
  if (h.month === 10 && h.day === 2) reasons.push("بداية صيام الست من شوال");
  if (h.day >= 13 && h.day <= 15) reasons.push(`${h.day === 13 ? "أول " : h.day === 15 ? "آخر " : ""}الأيام البيض (${ar(h.day)} ${h.monthName})`);
  if (weekly && wd === "Mon") reasons.push("صيام يوم الاثنين");
  if (weekly && wd === "Thu") reasons.push("صيام يوم الخميس");
  return { ...base, forbidden: false, reasons };
}

/** The next `days` days that are sunnah fasts, starting tomorrow. */
function upcoming(now, timeZone, { days = 14, weekly = true } = {}) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const date = new Date(now + i * DAY);
    const f = fastsOn(date, timeZone, { weekly });
    if (f.reasons.length) out.push({ ...f, date, inDays: i, day: zoneNow(timeZone, date.getTime()).day });
  }
  return out;
}

/** The reminder for tomorrow, or null if tomorrow is not a sunnah fast. */
function reminderFor(now, timeZone, { weekly = true } = {}) {
  const f = fastsOn(new Date(now + DAY), timeZone, { weekly });
  if (!f.reasons.length) return null;
  return [
    `🌙 *غداً ${f.weekday} ${ar(f.hijri.day)} ${f.hijri.monthName}*`,
    "",
    "يُستحب صيام الغد:",
    ...f.reasons.map((r) => `• ${r}`),
    "",
    "لا تنسَ نية الصيام والسحور، فإن في السحور بركة. 🤍",
    "_التاريخ الهجري حسب تقويم أم القرى، وقد يختلف يوماً حسب بلدك._",
  ].join("\n");
}

const store = (state) => state.store("siyam", {});
const get = (state, chat) => store(state).data[chat] || null;

function set(state, chat, changes) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { time: DEFAULT_TIME, weekly: true, ...(d[chat] || {}), ...changes };
    return d[chat];
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

/** Due at its time each evening, up to 3 h late, once a day. Exported for tests. */
function isDue(entry, timeZone, now) {
  const { day, minutes } = zoneNow(timeZone, now);
  const at = parseClock(entry.time || DEFAULT_TIME);
  if (entry.last === day || minutes < at || minutes > at + LATE_LIMIT_MIN) return false;
  return !(entry.retryAt && now < entry.retryAt);
}

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    if (!isDue(entry, zone, now)) continue;
    const text = reminderFor(now, zone, { weekly: entry.weekly !== false });
    try {
      if (text) await app.sock.sendMessage(chat, { text });
      s.update(() => {
        entry.last = zoneNow(zone, now).day;
        delete entry.retryAt;
      });
      if (text) sent++;
    } catch (err) {
      s.update(() => (entry.retryAt = now + RETRY_MS));
      app.log.warn({ err: err.message }, "fasting reminder failed; retrying in 10 minutes");
    }
  }
  return sent;
}

function startSiyamLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "fasting reminder loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { fastsOn, upcoming, reminderFor, get, set, remove, isDue, runDue, startSiyamLoop, DEFAULT_TIME, MONTHS_AR, ar };
