"use strict";

const geo = require("../../services/geo");
const tc = require("../../services/timecalc");

const clock = (instant, timeZone) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));

function difference(minutes, a, b) {
  if (minutes === 0) return `${b} and ${a} have the same time.`;
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${b} is ${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""} ${minutes > 0 ? "ahead of" : "behind"} ${a}.`;
}

module.exports = [
  {
    name: "tz",
    aliases: ["timezone", "convert-time", "timeconv"],
    category: "tools",
    description: "Converts a time from one city to another (daylight saving included), or compares the current time in two cities.",
    usage: "[time] <city> to <city>",
    examples: [".tz 15:00 Cairo to London", ".tz 9am New York to Tokyo", ".tz Riyadh Paris"],
    cooldown: 5,
    externalService: "open-meteo.com (city lookup)",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}tz 15:00 Cairo to London  ·  ${ctx.prefix}tz Riyadh Paris`);
      const q = tc.parseTz(ctx.text);
      const [a, b] = await Promise.all([geo.geocode(q.from), geo.geocode(q.to)]);
      const now = Date.now();
      const instant = q.minutes === null ? now : tc.zonedInstant(a.timezone, tc.localDate(a.timezone, now), q.minutes);
      const diff = tc.offsetMinutes(b.timezone, instant) - tc.offsetMinutes(a.timezone, instant);
      const head = q.minutes === null ? "🕒 *Now*" : "🕒 *Time conversion*";
      return ctx.reply(
        `${head}\n\n📍 ${geo.label(a)}: *${clock(instant, a.timezone)}*\n📍 ${geo.label(b)}: *${clock(instant, b.timezone)}*\n\n${difference(diff, a.name, b.name)}`,
      );
    },
  },
  {
    name: "days",
    aliases: ["countdown", "daysuntil", "datecalc"],
    category: "tools",
    description: "Date calculator: days until or since a date, between two dates, or the date N days from today (in the bot's time zone).",
    usage: "<date> | <date> <date> | +N | -N",
    examples: [".days 2026-12-31", ".days 01/01/2026 31/12/2026", ".days +90", ".days -30"],
    cooldown: 2,
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}days 2026-12-31 · ${ctx.prefix}days 01/01/2026 31/12/2026 · ${ctx.prefix}days +90`);
      return ctx.reply(tc.daysAnswer(ctx.text, tc.localDate(ctx.config.bot.timezone, Date.now())));
    },
  },
];
