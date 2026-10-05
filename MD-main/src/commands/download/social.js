"use strict";

const ytdlp = require("../../services/ytdlp");

function socialDownloader(site, label, maxItems = 1) {
  return async (ctx) => {
    const url = ytdlp.matchSiteUrl(ctx.text, site);
    if (!url) return ctx.reply(`Please send a valid ${label} link.\nUsage: ${ctx.prefix}${ctx.commandName} <link>`);
    await ctx.react("🔄");
    const items = await ytdlp.download(ctx.config, { target: url, kind: "video", maxItems, hasFfmpeg: ctx.app.capabilities.ffmpeg });
    for (const item of items) {
      await ctx.reply({ video: item.buffer, mimetype: "video/mp4", caption: item.title ? `📝 ${item.title.slice(0, 200)}` : undefined });
    }
    return undefined;
  };
}

const base = { category: "download", cooldown: 30, requires: ["ytdlp"], usage: "<link>" };

// Sites whose posts can contain several videos.
const MULTI = new Set(["instagram", "twitter", "threads", "reddit"]);
const SITE_LIST = Object.keys(ytdlp.HOSTS).join(", ");

async function universal(ctx) {
  const found = ytdlp.detectSite(ctx.text);
  if (!found) {
    return ctx.reply(`Send a link from one of these sites:\n${SITE_LIST}\n\nUsage: ${ctx.prefix}${ctx.commandName} <link>`);
  }
  const audio = ytdlp.AUDIO_SITES.has(found.site);
  if (audio && !ctx.app.capabilities.ffmpeg) return ctx.reply("ffmpeg is not installed on the server, so audio can't be downloaded.");
  await ctx.react("🔄");
  const items = await ytdlp.download(ctx.config, {
    target: found.url,
    kind: audio ? "audio" : "video",
    maxItems: MULTI.has(found.site) ? 10 : 1,
    hasFfmpeg: ctx.app.capabilities.ffmpeg,
  });
  for (const item of items) {
    if (audio) await ctx.reply({ audio: item.buffer, mimetype: "audio/mpeg", fileName: "audio.mp3" });
    else await ctx.reply({ video: item.buffer, mimetype: "video/mp4", caption: item.title ? `📝 ${item.title.slice(0, 200)}` : undefined });
  }
  return undefined;
}

module.exports = [
  {
    ...base,
    name: "dl",
    aliases: ["download", "get"],
    description: `Downloads the video (or SoundCloud audio) from a link on any supported site: ${SITE_LIST}.`,
    examples: [".dl https://x.com/…/status/…", ".dl https://www.reddit.com/r/…"],
    externalService: "the linked site, via yt-dlp",
    run: universal,
  },
  {
    ...base,
    name: "twitter",
    aliases: ["x", "tw"],
    description: "Downloads the videos of a post on X (Twitter).",
    externalService: "X/Twitter via yt-dlp",
    run: socialDownloader("twitter", "X (Twitter)", 10),
  },
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
