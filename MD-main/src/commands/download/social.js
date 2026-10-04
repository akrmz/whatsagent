"use strict";

const ytdlp = require("../../services/ytdlp");

function socialDownloader(site, label, maxItems = 1) {
  return async (ctx) => {
    const url = ytdlp.matchSiteUrl(ctx.text, site);
    if (!url) return ctx.reply(`Please send a valid ${label} link.\nUsage: ${ctx.prefix}${ctx.commandName} <link>`);
    await ctx.react("🔄");
    const items = await ytdlp.download(ctx.config, { target: url, kind: "video", maxItems });
    for (const item of items) {
      await ctx.reply({ video: item.buffer, mimetype: "video/mp4", caption: item.title ? `📝 ${item.title.slice(0, 200)}` : undefined });
    }
    return undefined;
  };
}

const base = { category: "download", cooldown: 30, requires: ["ytdlp"], usage: "<link>" };

module.exports = [
  {
    ...base,
    name: "tiktok",
    aliases: ["tt"],
    description: "Downloads a TikTok video.",
    externalService: "TikTok via yt-dlp",
    run: socialDownloader("tiktok", "TikTok"),
  },
  {
    ...base,
    name: "facebook",
    aliases: ["fb"],
    description: "Downloads a public Facebook video.",
    externalService: "Facebook via yt-dlp",
    run: socialDownloader("facebook", "Facebook"),
  },
  {
    ...base,
    name: "instagram",
    aliases: ["insta", "ig"],
    description: "Downloads the videos of a public Instagram post or reel (photos are not supported; private posts need YTDLP_COOKIES).",
    externalService: "Instagram via yt-dlp",
    run: socialDownloader("instagram", "Instagram", 10),
  },
];
