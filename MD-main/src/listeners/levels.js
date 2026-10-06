"use strict";

const levels = require("../services/levels");
const { at } = require("../services/targets");

module.exports = {
  name: "levels",
  event: "message",
  phase: "pre",
  priority: 31, // right after the message counter
  groupOnly: true,
  async run(ctx) {
    // Commands don't earn XP (otherwise .flip spam would be the fastest way up).
    if (ctx.fromMe || !ctx.body || ctx.body.startsWith(ctx.prefix)) return;
    const r = levels.addXp(ctx.state, ctx.chatId, ctx.sender);
    if (r?.levelUp && levels.announces(ctx.state, ctx.chatId)) {
      await ctx.send({ text: `🎉 ${at(ctx.sender)} reached *level ${r.level}*!`, mentions: [ctx.sender] }).catch(() => {});
    }
  },
};
