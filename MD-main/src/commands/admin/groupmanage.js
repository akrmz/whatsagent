"use strict";

const { toPng } = require("../../core/media");

const base = { category: "admin", permission: "groupAdmin", botAdmin: true, cooldown: 10 };

module.exports = [
  {
    ...base,
    name: "setgdesc",
    description: "Changes the group description.",
    usage: "<description>",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}setgdesc <description>`);
      await ctx.sock.groupUpdateDescription(ctx.chatId, ctx.text.slice(0, 2048));
      return ctx.reply("✅ Group description updated.");
    },
  },
  {
    ...base,
    name: "setgname",
    description: "Changes the group name.",
    usage: "<name>",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}setgname <new name>`);
      await ctx.sock.groupUpdateSubject(ctx.chatId, ctx.text.slice(0, 100));
      return ctx.reply("✅ Group name updated.");
    },
  },
  {
    ...base,
    name: "setgpp",
    description: "Sets the group photo from the image or sticker you reply to.",
    usage: "(reply to an image)",
    async run(ctx) {
      const media = ctx.findMedia({ types: ["image", "sticker"], own: false });
      if (!media) return ctx.reply(`Reply to an image or sticker with ${ctx.prefix}setgpp`);
      const buffer = await ctx.download(media, 10 * 1024 * 1024);
      await ctx.sock.updateProfilePicture(ctx.chatId, media.type === "sticker" ? await toPng(buffer) : buffer);
      return ctx.reply("✅ Group photo updated.");
    },
  },
  {
    ...base,
    name: "resetlink",
    aliases: ["revoke", "anularlink"],
    description: "Revokes the group invite link and shows the new one.",
    async run(ctx) {
      const code = await ctx.sock.groupRevokeInvite(ctx.chatId);
      return ctx.reply(`✅ Group link reset.\n\n📌 New link:\nhttps://chat.whatsapp.com/${code}`);
    },
  },
  {
    name: "clear",
    category: "admin",
    description: "Sends and immediately deletes a bot message (clears the chat preview).",
    groupOnly: true,
    async run(ctx) {
      const sent = await ctx.send("Clearing…");
      await ctx.sock.sendMessage(ctx.chatId, { delete: sent.key });
    },
  },
];
