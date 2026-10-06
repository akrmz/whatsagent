"use strict";

const prayertimes = require("../../services/prayertimes");
const hijri = require("../../services/hijri");
const geo = require("../../services/geo");
const { getJson } = require("../../core/http");
const { UserError } = require("../../core/errors");
const azkar = require("../../services/azkar");

/** Arabic duration with correct number forms: "ساعة و5 دقائق", "ساعتان", "11 ساعة ودقيقتان". */
function left(total) {
  const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const parts = [];
  if (h) parts.push(plural(h, "ساعة", "ساعتان", "ساعات", "ساعة"));
  if (m || !h) parts.push(plural(m, "دقيقة", "دقيقتان", "دقائق", "دقيقة"));
  return parts.join(" و");
}

module.exports = [
  {
    name: "imsakiya",
    aliases: ["imsakia", "ramadantable", "emsakeya"],
    category: "islamic",
    description: "إمساكية رمضان لمدينتك: الإمساك والفجر والمغرب لكل يوم من الشهر — the Ramadan timetable (Imsak, Fajr, Maghrib) for a city, for the current or next Ramadan.",
    usage: "<city>",
    examples: [".imsakiya Cairo", ".imsakiya الرياض"],
    cooldown: 20,
    externalService: "aladhan.com, open-meteo.com (city lookup)",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`الاستخدام: ${ctx.prefix}imsakiya <المدينة>`);
      const place = await geo.geocode(ctx.text);
      const today = hijri.toHijri(new Date(), place.timezone);
      // During Ramadan: this one; otherwise the next one.
      const year = today.month === 9 ? today.year : hijri.nextOccurrence(9, 1, new Date(), place.timezone).hijri.year;
      const qs = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude) });
      const res = await getJson(`https://api.aladhan.com/v1/hijriCalendar/${year}/9?${qs}`, { timeoutMs: 20000 });
      const days = res.data || [];
      if (!days.length) throw new UserError("تعذّر الحصول على الإمساكية الآن.");
      const t = (s) => String(s).slice(0, 5);
      const lines = days.map((d) => {
        const g = d.date.gregorian;
        const mark = d.date.hijri.day === String(today.day).padStart(2, "0") && today.month === 9 ? " ◀️" : "";
        return `${Number(d.date.hijri.day)} · ${g.day}/${g.month.number} · إمساك ${t(d.timings.Imsak)} · فجر ${t(d.timings.Fajr)} · مغرب ${t(d.timings.Maghrib)}${mark}`;
      });
      const method = days[0].meta?.method?.name;
      return ctx.reply(`🌙 *إمساكية رمضان ${year} هـ — ${geo.label(place)}*\n_اليوم · التاريخ · الإمساك · الفجر · المغرب (${place.timezone})_\n\n${lines.join("\n")}${method ? `\n\n_${method}_` : ""}\n\n_قد تختلف بداية الشهر يوماً حسب رؤية الهلال._`);
    },
  },
  {
    name: "iftar",
    aliases: ["suhoor", "sohour", "maghrib"],
    category: "islamic",
    description: "كم بقي على المغرب (الإفطار) وعلى الإمساك (السحور) في مدينتك — time left until Maghrib (iftar) and Imsak (suhoor) in a city.",
    usage: "<city>",
    examples: [".iftar Cairo", ".suhoor Makkah"],
    cooldown: 10,
    externalService: "aladhan.com, open-meteo.com (city lookup)",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`الاستخدام: ${ctx.prefix}iftar <المدينة>`);
      const p = await prayertimes.forCity(ctx.text);
      const until = (m) => (m - p.minutes + 1440) % 1440;
      const maghrib = p.times.Maghrib;
      const imsak = p.times.Imsak ?? p.times.Fajr - 10;
      const ramadan = hijri.toHijri(new Date(), p.zone).month === 9;
      const lines = [`🕌 *${p.city}* — الآن ${prayertimes.hhmm(p.minutes)} (${p.zone})`, ""];
      lines.push(`🌇 ${ramadan ? "الإفطار" : "المغرب"} ${prayertimes.hhmm(maghrib)} — ${until(maghrib) === 0 ? "*حان الآن*" : `بعد *${left(until(maghrib))}*`}`);
      lines.push(`🌙 الإمساك ${prayertimes.hhmm(imsak)} — بعد ${left(until(imsak))}`);
      // The iftar dua, from Hisn al-Muslim (chapter 68), when iftar is near.
      if (ramadan && until(maghrib) < 30) lines.push("", `🤲 *دعاء الإفطار:*\n${azkar.chapterItems(68)[0].text}\n_📖 حصن المسلم_`);
      return ctx.reply(lines.join("\n"));
    },
  },
];
