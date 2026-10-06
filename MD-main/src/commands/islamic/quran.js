"use strict";

const { getJson, getBuffer, HttpError } = require("../../core/http");
const quran = require("../../services/quran");

module.exports = {
  name: "quran",
  aliases: ["ayah", "ayat"],
  category: "islamic",
  description: "Shows a Quran verse in Arabic with an English translation; add \"audio\" for the recitation (Alafasy). Without a reference, a random verse.",
  usage: "[surah:ayah | surah name and verse] [audio]",
  examples: [".quran 2:255", ".quran البقرة 255", ".quran kahf 10 audio", ".quran 112:1", ".quran"],
  cooldown: 5,
  externalService: "alquran.cloud",

  async run(ctx) {
    // ".quran 2:255 audio" (or صوت / تلاوة) also sends the recitation.
    const withAudio = /\s*(audio|voice|صوت|تلاوة)$/i.test(ctx.text);
    let ref = ctx.text.replace(/\s*(audio|voice|صوت|تلاوة)$/i, "").trim();
    if (!ref) ref = String(1 + Math.floor(Math.random() * quran.TOTAL_AYAHS)); // verse number 1–6236
    else {
      const parsed = quran.parseRef(ref);
      if (!parsed) return ctx.reply(`Usage: ${ctx.prefix}quran <surah:ayah> [audio], e.g. ${ctx.prefix}quran 2:255 audio or ${ctx.prefix}quran البقرة 255. Search: ${ctx.prefix}qsearch <word>`);
      ref = parsed.ref;
    }
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
    await ctx.reply(
      `📖 *${s.englishName} (${s.name})* ${s.number}:${ar.numberInSurah}\n\n${ar.text}\n\n_${en?.text || ""}_\n\n— ${en?.edition?.englishName || "Translation"}`,
    );
    if (!withAudio) return undefined;
    // ar.number is the verse's number in the whole Quran, which the audio files use.
    const { buffer } = await getBuffer(`https://cdn.islamic.network/quran/audio/128/ar.alafasy/${ar.number}.mp3`, { maxBytes: 10 * 1024 * 1024, timeoutMs: 30000 });
    return ctx.reply({ audio: buffer, mimetype: "audio/mpeg", fileName: `${s.number}-${ar.numberInSurah}.mp3` });
  },
};
