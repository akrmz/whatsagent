"use strict";

const ytdlp = require("../../services/ytdlp");

const safeName = (s) => String(s || "media").replace(/[^\w\s.-]/g, "").trim().slice(0, 80) || "media";

function youtube(kind) {
  return async (ctx) => {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}${ctx.commandName} <song name or YouTube link>`);
    const url = ytdlp.matchSiteUrl(ctx.text, "youtube");
    const query = ctx.commandName === "spotify" ? `${ctx.text} official audio` : ctx.text;
    await ctx.react("🔎");
    const [item] = await ytdlp.download(ctx.config, { target: url || query.slice(0, 200), search: !url, kind, hasFfmpeg: ctx.app.capabilities.ffmpeg });
    if (kind === "audio") {
      return ctx.reply({ audio: item.buffer, mimetype: "audio/mpeg", fileName: `${safeName(item.title)}.mp3` });
    }
    return ctx.reply({ video: item.buffer, mimetype: "video/mp4", caption: `*${item.title}*` });
  };
}

const base = {
  category: "download",
  cooldown: 30,
  requires: ["ytdlp"],
  externalService: "YouTube via yt-dlp",
};

module.exports = [
  {
    ...base,
    name: "song",
    aliases: ["play", "mp3", "ytmp3", "music"],
    description: "Finds a song on YouTube (or uses your YouTube link) and sends it as audio.",
    usage: "<song name | YouTube link>",
    examples: [".play adele hello", ".song https://youtu.be/…"],
    requires: ["ytdlp", "ffmpeg"],
    run: youtube("audio"),
  },
  {
    ...base,
    name: "spotify",
    description: "Finds a track by name and sends it as audio (searched on YouTube; Spotify links are not downloaded).",
    usage: "<song or artist>",
    requires: ["ytdlp", "ffmpeg"],
    run: youtube("audio"),
  },
  {
    ...base,
    name: "video",
    aliases: ["ytmp4"],
    description: "Finds a video on YouTube (or uses your link) and sends it (max 720p, size and length limited).",
    usage: "<search | YouTube link>",
    run: youtube("video"),
  },
];
