"use strict";

const { getJson, HttpError } = require("../../core/http");

module.exports = {
  name: "quran",
  aliases: ["ayah", "ayat"],
  category: "islamic",
  description: "Shows a Quran verse in Arabic with an English translation. Without a reference, a random verse.",
  usage: "[surah:ayah]",
  examples: [".quran 2:255", ".quran 112:1", ".quran"],
  cooldown: 5,
  externalService: "alquran.cloud",

  async run(ctx) {
    let ref = ctx.text.trim();
    if (!ref) ref = String(1 + Math.floor(Math.random() * 6236)); // verse number 1–6236
    else if (!/^\d{1,3}:\d{1,3}$/.test(ref)) return ctx.reply(`Usage: ${ctx.prefix}quran <surah:ayah>, e.g. ${ctx.prefix}quran 2:255`);
    let res;
    try {
      res = await getJson(`https://api.alquran.cloud/v1/ayah/${ref}/editions/quran-uthmani,en.sahih`, { timeoutMs: 15000 });
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return ctx.reply(`There is no verse ${ref}.`);
      throw err;
    }
    const [ar, en] = res.data || [];
    if (!ar) return ctx.reply(`There is no verse ${ref}.`);
    const s = ar.surah || {};
    return ctx.reply(
      `📖 *${s.englishName} (${s.name})* ${s.number}:${ar.numberInSurah}\n\n${ar.text}\n\n_${en?.text || ""}_\n\n— ${en?.edition?.englishName || "Translation"}`,
    );
  },
};
