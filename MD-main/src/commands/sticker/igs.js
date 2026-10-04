"use strict";

const ytdlp = require("../../services/ytdlp");
const { toSticker } = require("../../core/media");
const { stickerOptions } = require("../../services/stickers");

function igSticker(crop) {
  return async (ctx) => {
    const url = ytdlp.matchSiteUrl(ctx.text, "instagram");
    if (!url) return ctx.reply(`Send an Instagram post or reel link.\nUsage: ${ctx.prefix}${ctx.commandName} <url>`);
    await ctx.react("🔄");
    const items = await ytdlp.download(ctx.config, { target: url, kind: "video", maxItems: 5 });
    for (const item of items) {
      const sticker = await toSticker(item.buffer, { ...stickerOptions(ctx), animated: true, crop });
      await ctx.reply({ sticker });
    }
    return undefined;
  };
}

const base = {
  category: "sticker",
  usage: "<instagram link>",
  cooldown: 30,
  requires: ["ytdlp"],
  externalService: "instagram.com via yt-dlp (videos only; private posts need YTDLP_COOKIES)",
};

module.exports = [
  { ...base, name: "igs", description: "Turns the videos of an Instagram post into stickers.", run: igSticker(false) },
  { ...base, name: "igsc", description: "Like .igs but crops to a square.", run: igSticker(true) },
];
