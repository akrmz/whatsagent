"use strict";

const quiz = require("../services/quiz");
const { POINTS } = require("../commands/games/quick");
const { at } = require("../services/targets");

/** Answers to a running .mathquiz: a message that is just the right number wins. */
module.exports = {
  name: "mathquiz",
  event: "message",
  phase: "post",
  priority: 15, // after tic-tac-toe moves (10), which also use plain numbers
  async run(ctx) {
    if (!quiz.active(ctx.chatId)) return undefined;
    const won = quiz.answer(ctx.chatId, ctx.body);
    if (!won) return undefined;
    const total = quiz.addPoint(ctx.state, ctx.chatId, ctx.sender, POINTS[won.level]);
    await ctx.reply({ text: `✅ ${at(ctx.sender)} got it in ${won.seconds}s: *${won.q} = ${won.a}* (+${POINTS[won.level]}, total ${total})`, mentions: [ctx.sender] });
    return "stop";
  },
};
