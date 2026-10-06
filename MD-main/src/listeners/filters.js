"use strict";

const filters = require("../services/filters");
const { LRU } = require("../core/lru");

// At most one auto-reply per group every 5 s, and the same one at most every 30 s,
// so two people (or two bots) can't make the bot flood the group.
const recent = new LRU({ max: 10000, ttlMs: 30 * 1000 });

module.exports = {
  name: "filters",
  event: "message",
  phase: "post",
  priority: 25,
  groupOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe || !ctx.body) return undefined;
    const hit = filters.match(ctx.state, ctx.chatId, ctx.body);
    if (!hit) return undefined;
    const now = Date.now();
    if (now - (recent.get(ctx.chatId) || 0) < 5000 || recent.get(`${ctx.chatId}|${hit.key}`)) return undefined;
    recent.set(ctx.chatId, now);
    recent.set(`${ctx.chatId}|${hit.key}`, true);
    await ctx.reply(hit.reply);
    return "stop";
  },
};
