"use strict";

const { resolveTargets, at } = require("../../services/targets");
const { LRU } = require("../../core/lru");

// The last .groups list, so ".leavegroup 3" can refer to it.
const lastList = new LRU({ max: 10, ttlMs: 30 * 60 * 1000 });

const INVITE_RE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})/;

async function allGroups(ctx) {
  const groups = Object.values((await ctx.sock.groupFetchAllParticipating()) || {});
  return groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0));
}

const base = { category: "owner", permission: "owner", cooldown: 5 };

module.exports = [
  {
    ...base,
    name: "groups",
    aliases: ["listgroups", "grouplist"],
    description: "Lists every group the bot is in, with member counts and whether the bot is an admin there.",
    async run(ctx) {
      const groups = await allGroups(ctx);
      if (!groups.length) return ctx.reply("The bot is not in any group.");
      lastList.set(ctx.chatId, groups.map((g) => g.id));
      const botIds = new Set(ctx.app.identity.aliases(ctx.sock.user?.id).concat(ctx.app.identity.aliases(ctx.sock.user?.lid)));
      const lines = groups.slice(0, 100).map((g, i) => {
        const admin = (g.participants || []).some((p) => p.admin && ctx.app.identity.aliases(p.id).some((a) => botIds.has(a)));
        return `${i + 1}. *${g.subject || "(no name)"}* · ${g.participants?.length || 0} members${admin ? " · 👮 admin" : ""}${g.announce ? " · 🔒" : ""}`;
      });
      return ctx.reply(`👥 *Groups* (${groups.length})\n\n${lines.join("\n")}\n\nLeave one: ${ctx.prefix}leavegroup <number>`);
    },
  },
  {
    ...base,
    name: "leavegroup",
    aliases: ["exitgroup"],
    description: "Makes the bot leave a group by its number from .groups.",
    usage: "<number from .groups>",
    async run(ctx) {
      const n = Number(ctx.args[0]);
      const id = lastList.get(ctx.chatId)?.[n - 1];
      if (!id) return ctx.reply(`Send ${ctx.prefix}groups first, then ${ctx.prefix}leavegroup <number>.`);
      const meta = await ctx.app.groups.get(ctx.sock, id).catch(() => null);
      await ctx.sock.sendMessage(id, { text: "👋 Goodbye!" }).catch(() => {});
      await ctx.sock.groupLeave(id);
      ctx.app.groups.invalidate(id);
      lastList.delete(ctx.chatId);
      return ctx.reply(`✅ Left *${meta?.subject || id}*.`);
    },
  },
  {
    ...base,
    name: "join",
    aliases: ["joingroup"],
    description: "Makes the bot join a group from an invite link.",
    usage: "<chat.whatsapp.com link>",
    examples: [".join https://chat.whatsapp.com/AbCdEf123456"],
    cooldown: 15,
    async run(ctx) {
      const code = (ctx.text.match(INVITE_RE) || [])[1];
      if (!code) return ctx.reply(`Usage: ${ctx.prefix}join https://chat.whatsapp.com/…`);
      try {
        const id = await ctx.sock.groupAcceptInvite(code);
        const meta = id ? await ctx.app.groups.get(ctx.sock, id).catch(() => null) : null;
        return ctx.reply(`✅ Joined${meta?.subject ? ` *${meta.subject}*` : ""}.`);
      } catch (err) {
        ctx.log.warn({ err: err.message }, "join failed");
        return ctx.reply("❌ Couldn't join: the link may be expired or revoked, or the group needs admin approval.");
      }
    },
  },
  {
    ...base,
    name: "block",
    description: "Blocks someone on the bot's WhatsApp account (they can't message or call it). Mention them, reply to them, or give the number.",
    usage: "<@user | reply | number>",
    async run(ctx) {
      const [jid] = resolveTargets(ctx, { max: 1 });
      if (!jid) return ctx.reply(`Usage: ${ctx.prefix}block @user (or reply to them)`);
      if (ctx.app.permissions.levelOf({ sender: jid }) === "owner") return ctx.reply("The owner can't be blocked.");
      await ctx.sock.updateBlockStatus(jid, "block");
      return ctx.reply({ text: `🚫 Blocked ${at(jid)}.`, mentions: [jid] });
    },
  },
  {
    ...base,
    name: "unblock",
    description: "Unblocks someone on the bot's WhatsApp account.",
    usage: "<@user | reply | number>",
    async run(ctx) {
      const [jid] = resolveTargets(ctx, { max: 1 });
      if (!jid) return ctx.reply(`Usage: ${ctx.prefix}unblock @user (or the number)`);
      await ctx.sock.updateBlockStatus(jid, "unblock");
      return ctx.reply({ text: `✅ Unblocked ${at(jid)}.`, mentions: [jid] });
    },
  },
];
