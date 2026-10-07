"use strict";

const qq = require("../services/quranquiz");
const { at } = require("../services/targets");

/** Answers to a running .quranquiz: a message that is just 1–4. Wrong answers get a quiet ❌. */
module.exports = {
  name: "quranquiz",
  event: "message",
  phase: "post",
  priority: 16, // after tic-tac-toe moves (10) and the math quiz (15)
  async run(ctx) {
    if (!qq.active(ctx.chatId)) return undefined;
    const r = qq.answer(ctx.chatId, ctx.sender, ctx.body);
    if (!r) return undefined;
    if (!r.correct) {
      await ctx.react("❌");
      return "stop";
    }
    const total = qq.addPoint(ctx.state, ctx.chatId, ctx.sender);
    await ctx.reply({ text: `✅ ${at(ctx.sender)} أصاب في ${qq.ar(r.seconds)} ث: ${qq.reveal(r.round)} (+١، المجموع ${qq.ar(total)})`, mentions: [ctx.sender] });
    return "stop";
  },
};
