"use strict";

const { UserError } = require("../core/errors");

/** Time-zone conversion (.tz) and date arithmetic (.days). No network except the city lookups in .tz. */

const DAY = 86400 * 1000;

/** Minutes the zone is ahead of UTC at that instant (DST included). */
function offsetMinutes(timeZone, instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** The local date (y, m, d) of an instant in a zone. */
function localDate(timeZone, instant) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant)).split("-").map(Number);
  return { y, m, d };
}

/** The instant when the clock in `timeZone` shows y-m-d hh:mm. */
function zonedInstant(timeZone, { y, m, d }, minutes) {
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let t = naive - offsetMinutes(timeZone, naive) * 60000;
  t = naive - offsetMinutes(timeZone, t) * 60000; // once more, in case DST changes in between
  return t;
}

/** "15:00", "3pm", "3:30 pm" → minutes after midnight, or null. */
function parseTime(text) {
  const m = String(text).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  }
  return h > 23 ? null : h * 60 + min;
}

/**
 * ".tz 15:00 Cairo to London", ".tz Cairo London", ".tz 9am New York in Tokyo".
 * @returns {{ minutes: number|null, from: string, to: string }}
 */
function parseTz(text) {
  const t = String(text || "").trim();
  let from;
  let to;
  const sep = t.split(/\s+(?:to|in|->|→|إلى|الى)\s+/i);
  if (sep.length === 2) [from, to] = sep;
  else {
    const words = t.split(/\s+/);
    if (words.length < 2) throw new UserError("Usage: .tz [time] <city> to <city>, e.g. .tz 15:00 Cairo to London");
    to = words.pop();
    from = words.join(" ");
  }
  const tm = from.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(.+)$/i);
  const minutes = tm ? parseTime(tm[1]) : null;
  if (tm && minutes === null) throw new UserError("Write the time like 15:00 or 3pm.");
  return { minutes, from: (tm ? tm[2] : from).trim(), to: to.trim() };
}

// ---- dates ----

/** "2026-12-31", "31/12/2026", "31-12-2026", "31.12.2026" → { y, m, d }, or null. */
function parseDate(text) {
  const s = String(text || "").trim();
  let y;
  let m;
  let d;
  let r = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [, y, m, d] = r.map(Number);
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = r.map(Number);
  else return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) throw new UserError(`${s} is not a real date.`);
  return { y, m, d };
}

const dayNumber = ({ y, m, d }) => Date.UTC(y, m - 1, d) / DAY;
const fromDayNumber = (n) => {
  const t = new Date(n * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const fmtDate = (x) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(x.y, x.m - 1, x.d)));

/** Whole years, months and days from a to b (a <= b). */
function ymd(a, b) {
  let years = b.y - a.y;
  let months = b.m - a.m;
  let days = b.d - a.d;
  if (days < 0) {
    months--;
    days += new Date(Date.UTC(b.y, b.m - 1, 0)).getUTCDate(); // days in the month before b's
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return { years, months, days };
}

/**
 * ".days 2026-12-31" (from today), ".days 2026-01-01 2026-12-31", ".days +90", ".days -30".
 * @returns {string} the answer
 */
function daysAnswer(text, today) {
  const args = String(text || "").trim().split(/\s+/).filter(Boolean);
  const plural = (n, w) => `${n.toLocaleString("en-US")} ${w}${Math.abs(n) === 1 ? "" : "s"}`;
  if (args.length === 1 && /^[+-]\d{1,6}$/.test(args[0])) {
    const n = Number(args[0]);
    const target = fromDayNumber(dayNumber(today) + n);
    return `📅 ${n >= 0 ? `${plural(n, "day")} from today` : `${plural(-n, "day")} ago`}: *${fmtDate(target)}*`;
  }
  const dates = args.map(parseDate);
  if (!args.length || args.length > 2 || dates.some((x) => !x)) {
    throw new UserError("Usage: .days 2026-12-31 · .days 01/01/2026 31/12/2026 · .days +90 · .days -30");
  }
  const [a, b] = dates.length === 2 ? dates : [today, dates[0]];
  const diff = dayNumber(b) - dayNumber(a);
  const [lo, hi] = diff >= 0 ? [a, b] : [b, a];
  const p = ymd(lo, hi);
  const parts = [p.years && plural(p.years, "year"), p.months && plural(p.months, "month"), p.days && plural(p.days, "day")].filter(Boolean).join(", ") || "0 days";
  const weeks = Math.floor(Math.abs(diff) / 7);
  const what =
    dates.length === 2
      ? `Between ${fmtDate(a)} and ${fmtDate(b)}`
      : diff === 0
        ? "That's today"
        : diff > 0
          ? `Until ${fmtDate(b)}`
          : `Since ${fmtDate(b)}`;
  return `📅 ${what}:\n*${plural(Math.abs(diff), "day")}* (${parts}${weeks ? `; ${plural(weeks, "week")}${Math.abs(diff) % 7 ? ` and ${plural(Math.abs(diff) % 7, "day")}` : ""}` : ""})`;
}

module.exports = { offsetMinutes, localDate, zonedInstant, parseTime, parseTz, parseDate, daysAnswer, ymd };
