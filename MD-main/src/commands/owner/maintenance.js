"use strict";

const fs = require("node:fs");
const path = require("node:path");

function clearDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    n++;
  }
  return n;
}

module.exports = [
  {
    name: "cleartmp",
    category: "owner",
    description: "Deletes leftover temporary files.",
    permission: "sudo",
    async run(ctx) {
      const n = clearDir(ctx.config.paths.tmp);
      return ctx.reply(`✅ Removed ${n} temporary item(s).`);
    },
  },
  {
    name: "clearsession",
    aliases: ["clearsesi"],
    category: "owner",
    description:
      "Deletes cached encryption key files from the session folder (keeps creds.json). Only for fixing persistent 'waiting for this message' errors; restart the bot afterwards.",
    usage: "confirm",
    permission: "owner",
    async run(ctx) {
      if ((ctx.args[0] || "").toLowerCase() !== "confirm") {
        return ctx.reply(
          `⚠️ This deletes the session's cached key files (not your login) and may cause a short burst of decryption retries.\nSend *${ctx.prefix}clearsession confirm* to continue, then restart the bot.`,
        );
      }
      const dir = ctx.config.paths.session;
      let removed = 0;
      for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (name === "creds.json") continue;
        fs.rmSync(path.join(dir, name), { force: true, recursive: true });
        removed++;
      }
      return ctx.reply(`✅ Removed ${removed} cached session file(s). Restart the bot now.`);
    },
  },
  {
    name: "setpp",
    category: "owner",
    description: "Sets the bot's profile picture from the image you reply to.",
    usage: "(reply to an image)",
    permission: "owner",
    async run(ctx) {
      const media = ctx.findMedia({ types: ["image", "sticker"], own: false });
      if (!media) return ctx.reply(`⚠️ Reply to an image with ${ctx.prefix}setpp`);
      const { toPng } = require("../../core/media");
      const buffer = await ctx.download(media, 10 * 1024 * 1024);
      await ctx.sock.updateProfilePicture(ctx.sock.user.id, media.type === "sticker" ? await toPng(buffer) : buffer);
      return ctx.reply("✅ Bot profile picture updated.");
    },
  },
];
