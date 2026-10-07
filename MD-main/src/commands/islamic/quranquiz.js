"use strict";

const qq = require("../../services/quranquiz");
const quiz = require("../../services/quiz");
const { at } = require("../../services/targets");

module.exports = {
  name: "quranquiz",
  aliases: ["qquiz", "musabaqa", "whichsurah"],
  category: "islamic",
  description:
    "مسابقة قرآنية: من أي سورة هذه الآية؟ أول من يرسل رقم الإجابة الصحيحة يربح نقطة — a Quran quiz: which surah is this verse from? Four choices; the first right answer within 45 s wins a point, one try per person. \".quranquiz top\" shows the leaderboard.",
  usage: "[top]",
  examples: [".quranquiz", ".quranquiz top"],
  cooldown: 5,
  externalService: "alquran.cloud",
  async run(ctx) {
    if ((ctx.args[0] || "").toLowerCase() === "top") {
      const top = qq.leaderboard(ctx.state, ctx.chatId);
      if (!top.length) return ctx.reply(`لا توجد نقاط بعد. ابدأ: ${ctx.prefix}quranquiz`);
      return ctx.reply({ text: `🏆 *المسابقة القرآنية*\n\n${top.map(([u, n], i) => `${qq.ar(i + 1)}. ${at(u)} — ${qq.ar(n)}`).join("\n")}`, mentions: top.map(([u]) => u) });
    }
    const running = qq.active(ctx.chatId);
    if (running && !running.pending) return ctx.reply(qq.question(running));
    if (running || quiz.active(ctx.chatId)) return ctx.reply("⏳ هناك سؤال جارٍ في هذه المحادثة، انتظر انتهاءه.");
    const round = await qq.start(ctx.chatId);
    if (!round) return ctx.reply("⏳ هناك سؤال جارٍ في هذه المحادثة، انتظر انتهاءه.");
    setTimeout(() => {
      if (qq.expire(ctx.chatId, round)) ctx.send(`⏰ انتهى الوقت! الإجابة: ${qq.reveal(round)}\n${ctx.prefix}quranquiz لسؤال جديد`).catch(() => {});
    }, qq.ROUND_MS).unref?.();
    return ctx.send(qq.question(round));
  },
};
