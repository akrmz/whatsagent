"use strict";

const hamla = require("../services/hamla");
const { at } = require("../services/targets");

/** "+100" in a group with a running dhikr campaign adds 100 (a 📿 reaction, no reply). */
module.exports = {
  name: "hamla",
  event: "message",
  phase: "post",
  priority: 19,
  groupOnly: true,
  publicOnly: true,
  async run(ctx) {
    const m = ctx.body.trim().match(hamla.PLUS_RE);
    if (!m || !hamla.active(ctx.state, ctx.chatId)) return undefined;
    const n = hamla.toNumber(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > hamla.MAX_ADD) return undefined;
    const r = hamla.add(ctx.state, ctx.chatId, ctx.sender, n);
    await ctx.react("📿");
    if (r.finished || r.milestone) {
      const b = hamla.board(hamla.get(ctx.state, ctx.chatId), at);
      await ctx.send({ text: `${r.finished ? "🎉 *الحمد لله، اكتمل الهدف!*" : `✨ وصلنا إلى ${hamla.fmt(r.milestone)}٪ من الهدف!`}\n\n${b.text}`, mentions: b.mentions });
    }
    return "stop";
  },
};
