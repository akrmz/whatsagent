"use strict";

const { normalizeJid } = require("../../core/identity");
const { resolveTargets } = require("../../services/targets");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  name: "delete",
  aliases: ["del"],
  category: "admin",
  description: "Deletes recent messages: the replied message, the last N from a user, or the last N in the group (max 50, only messages the bot saw since it started).",
  usage: "[count] [@user] | (reply)",
  examples: [".del (reply)", ".del 5", ".del 3 @user"],
  permission: "groupAdmin",
  botAdmin: true,
  cooldown: 10,

  async run(ctx) {
    const count = Math.min(50, Math.max(0, parseInt(ctx.args.find((a) => /^\d+$/.test(a)) || "0", 10)));
    const target = resolveTargets(ctx, { allowNumbers: false })[0];
    const ctxInfoId = ctx.quoted?.id;
    if (!count && !target) {
      return ctx.reply(`Usage:\n• ${ctx.prefix}del 5 – last 5 messages\n• ${ctx.prefix}del 3 @user – last 3 from a user\n• reply with ${ctx.prefix}del – that message`);
    }

    const keys = [];
    if (ctxInfoId && ctx.quoted.sender) {
      keys.push({ id: ctxInfoId, participant: ctx.quoted.sender });
    }
    const limit = count || 1;
    const recent = ctx.app.store.recent(ctx.chatId).slice().reverse();
    const targetAliases = target ? new Set(ctx.app.identity.aliases(target)) : null;
    for (const m of recent) {
      if (keys.length >= limit) break;
      if (m.key.id === ctx.msg.key.id || m.key.fromMe || m.message?.protocolMessage) continue;
      if (keys.some((k) => k.id === m.key.id)) continue;
      const author = normalizeJid(m.key.participant || m.key.remoteJid);
      if (targetAliases && !ctx.app.identity.aliases(author).some((a) => targetAliases.has(a))) continue;
      keys.push({ id: m.key.id, participant: m.key.participant });
    }
    if (!keys.length) return ctx.reply("No recent messages found to delete.");
    for (const k of keys) {
      await ctx.sock.sendMessage(ctx.chatId, { delete: { remoteJid: ctx.chatId, fromMe: false, ...k } }).catch(() => {});
      await sleep(300);
    }
    return undefined;
  },
};
