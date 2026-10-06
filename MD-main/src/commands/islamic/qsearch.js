"use strict";

const quran = require("../../services/quran");

const PER_PAGE = 10;
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

module.exports = {
  name: "qsearch",
  aliases: ["searchquran", "quransearch", "bahth"],
  category: "islamic",
  description:
    "البحث عن كلمة في القرآن الكريم (بدون تشكيل)، أو في الترجمة الإنجليزية — searches the Quran for a word (Arabic, diacritics not needed) or the English translation (Sahih International). Add a page number at the end for more results.",
  usage: "<word or phrase> [page]",
  examples: [".qsearch الصبر", ".qsearch يا أيها الذين آمنوا 2", ".qsearch patience"],
  cooldown: 5,
  externalService: "alquran.cloud (the search words are sent)",
  async run(ctx) {
    let query = ctx.text.trim();
    let page = 1;
    const m = query.match(/^(.*\S)\s+([\d٠-٩]{1,2})$/);
    if (m) {
      query = m[1];
      page = Number(m[2].replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)));
    }
    if (!query) return ctx.reply(`الاستخدام: ${ctx.prefix}qsearch الصبر  ·  ${ctx.prefix}qsearch patience`);
    await ctx.react("🔎");
    const r = await quran.search(query);
    if (!r.count) return ctx.reply(`🔎 لم أجد "${query}" في ${r.arabic ? "القرآن" : "الترجمة"}. جرّب كلمة أقصر أو بدون "ال". — No results.`);
    const pages = Math.ceil(r.matches.length / PER_PAGE);
    if (page < 1 || page > pages) return ctx.reply(`النتائج ${ar(pages)} صفحات فقط. — Only ${pages} page(s).`);
    const shown = r.matches.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const lines = shown.map((x) => `• *${quran.plainName(x.surahName)}* ${x.surah}:${x.ayah}\n${clip(x.text, 180)}`);
    const more = page < pages ? `\n\nالمزيد: ${ctx.prefix}qsearch ${query} ${page + 1}` : "";
    return ctx.reply(
      `🔎 *"${query}"* — ${ar(r.count)} نتيجة${pages > 1 ? ` (صفحة ${ar(page)} من ${ar(pages)})` : ""}\n\n${lines.join("\n\n")}\n\nالآية كاملة مع التفسير: ${ctx.prefix}tafsir ${shown[0].surah}:${shown[0].ayah}${more}`,
    );
  },
};
