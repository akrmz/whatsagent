"use strict";

const { LRU } = require("../core/lru");
const { warnUser, deleteMessage } = require("../services/moderation");
const { at } = require("../services/targets");

/**
 * Flood protection (.antispam). Counts each member's messages per group in a sliding
 * window. Above the limit, every extra message is deleted, and once per window the member
 * is warned, removed or told to slow down. Admins, sudo, owner and the bot are exempt.
 */

const DEFAULT_RULE = { enabled: true, max: 6, seconds: 10, action: "delete" };
const spamRules = (state) => state.store("antispam", {});
const recent = new LRU({ max: 20000, ttlMs: 5 * 60 * 1000 });

/** Records a message; returns true if the sender is over the limit. Exported for tests. */
function track(key, rule, now = Date.now()) {
  const entry = recent.get(key) || { times: [], punishedAt: 0 };
  entry.times = entry.times.filter((t) => t > now - rule.seconds * 1000);
  entry.times.push(now);
  recent.set(key, entry);
  return { over: entry.times.length > rule.max, entry };
}

module.exports = {
  name: "antispam",
  event: "message",
  phase: "pre",
  priority: 42,
  groupOnly: true,
  async run(ctx) {
    const rule = spamRules(ctx.state).data[ctx.chatId];
    if (!rule?.enabled || ctx.fromMe || ctx.isSudoOrOwner) return undefined;
    const now = Date.now();
    const { over, entry } = track(`${ctx.chatId}|${ctx.sender}`, rule, now);
    if (!over) return undefined;
    if ((await ctx.isSenderAdmin()) || !(await ctx.isBotAdmin())) return undefined;
    await deleteMessage(ctx).catch(() => {});
    if (now - entry.punishedAt > rule.seconds * 1000) {
      entry.punishedAt = now;
      if (rule.action === "kick") {
        await ctx.sock.groupParticipantsUpdate(ctx.chatId, [ctx.sender], "remove").catch(() => {});
        await ctx.send({ text: `🚫 ${at(ctx.sender)} was removed for spamming.`, mentions: [ctx.sender] });
      } else if (rule.action === "warn") {
        await warnUser(ctx, ctx.sender, "spamming");
      } else {
        await ctx.send({ text: `⚠️ ${at(ctx.sender)} slow down — too many messages.`, mentions: [ctx.sender] });
      }
    }
    return "stop";
  },
};

module.exports.spamRules = spamRules;
module.exports.DEFAULT_RULE = DEFAULT_RULE;
module.exports.track = track;
