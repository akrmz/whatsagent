"use strict";

const { stopAll } = require("../../services/automations");

const base = { category: "admin", permission: "groupAdmin", botAdmin: true, cooldown: 10 };

module.exports = [
  {
    ...base,
    name: "link",
    aliases: ["invite", "grouplink", "gclink"],
    description: "Shows the group's invite link.",
    async run(ctx) {
      const code = await ctx.sock.groupInviteCode(ctx.chatId);
      if (!code) return ctx.reply("WhatsApp did not return an invite link for this group.");
      const meta = await ctx.groupMetadata();
      return ctx.reply(`🔗 *${meta?.subject || "Group"}*\nhttps://chat.whatsapp.com/${code}`);
    },
  },
  {
    ...base,
    name: "lock",
    description: "Only admins can change the group name, photo and description.",
    async run(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, "locked");
      return ctx.reply("🔒 Group info locked: only admins can edit it now.");
    },
  },
  {
    ...base,
    name: "unlock",
    description: "Lets every member change the group name, photo and description.",
    async run(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, "unlocked");
      return ctx.reply("🔓 Group info unlocked: every member can edit it now.");
    },
  },
  {
    name: "leave",
    aliases: ["leavegc", "exit"],
    category: "owner",
    description: "Makes the bot leave this group.",
    permission: "owner",
    groupOnly: true,
    async run(ctx) {
      await ctx.reply("👋 Goodbye!");
      await new Promise((r) => setTimeout(r, 1000));
      await ctx.sock.groupLeave(ctx.chatId);
      stopAll(ctx.state, ctx.chatId, { all: true });
      ctx.app.groups.invalidate(ctx.chatId);
    },
  },
];
