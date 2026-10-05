"use strict";

const { getJson } = require("../../core/http");
const geo = require("../../services/geo");

const NAMES = [
  ["Fajr", "الفجر"],
  ["Sunrise", "الشروق"],
  ["Dhuhr", "الظهر"],
  ["Asr", "العصر"],
  ["Maghrib", "المغرب"],
  ["Isha", "العشاء"],
];

/** Minutes since midnight for "HH:MM" (Aladhan may append " (EET)"). */
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(/[: ]/).map(Number);
  return h * 60 + m;
};

module.exports = {
  name: "prayer",
  aliases: ["salah", "salat", "adhan"],
  category: "info",
  description: "Shows today's prayer times for a city and which prayer is next.",
  usage: "<city>",
  examples: [".prayer Cairo", ".salah Makkah"],
  cooldown: 10,
  externalService: "aladhan.com (times), open-meteo.com (city lookup)",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}prayer <city>, e.g. ${ctx.prefix}prayer Cairo`);
    const place = await geo.geocode(ctx.text);
    // No "method" → Aladhan picks the calculation method used in that region.
    const qs = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude) });
    const res = await getJson(`https://api.aladhan.com/v1/timings?${qs}`, { timeoutMs: 15000 });
    const t = res.data?.timings;
    if (!t) return ctx.reply("Could not get prayer times right now. Try again later.");

    const local = new Intl.DateTimeFormat("en-GB", { timeZone: place.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const nowMin = minutes(local);
    const prayers = NAMES.filter(([n]) => n !== "Sunrise");
    const next = prayers.find(([n]) => minutes(t[n]) > nowMin) || prayers[0];

    const hijri = res.data.date?.hijri;
    const lines = [`🕌 *Prayer times — ${geo.label(place)}*`, res.data.date?.readable ? `📅 ${res.data.date.readable}${hijri ? ` · ${hijri.day} ${hijri.month?.en} ${hijri.year} AH` : ""}` : "", ""];
    for (const [n, ar] of NAMES) lines.push(`${n === next[0] ? "▶️" : "▫️"} ${n} (${ar}): *${String(t[n]).slice(0, 5)}*`);
    const method = res.data.meta?.method?.name;
    lines.push("", `Next: *${next[0]}* at ${String(t[next[0]]).slice(0, 5)} (local time ${local})`);
    if (method) lines.push(`_Method: ${method}_`);
    return ctx.reply(lines.filter((l, i) => l || i > 1).join("\n"));
  },
};
