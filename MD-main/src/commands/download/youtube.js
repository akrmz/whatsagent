"use strict";

const ytdlp = require("../../services/ytdlp");
const { linkText } = require("../../services/downloads");

// Keeps letters of every script (Arabic titles stay readable), digits, spaces, dots, dashes.
const safeName = (s) => String(s || "media").replace(/[^\p{L}\p{N}\s.-]/gu, "").trim().slice(0, 80) || "media";

const duration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "live/?");
const views = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n || 0));

function youtube(kind) {
  return async (ctx) => {
    // ".song" as a reply to a message with a YouTube link uses that link.
    const quotedUrl = !ctx.text && ctx.quoted ? ytdlp.matchSiteUrl(linkText(ctx), "youtube") : null;
    if (!ctx.text && !quotedUrl) return ctx.reply(`Usage: ${ctx.prefix}${ctx.commandName} <song name, YouTube link, or a number from ${ctx.prefix}yts>`);
    // ".play 2" right after ".yts …" picks result #2.
    const picked = /^\d{1,2}$/.test(ctx.text) ? ytdlp.recallSearch(ctx, Number(ctx.text)) : null;
    const url = quotedUrl || picked || ytdlp.matchSiteUrl(ctx.text, "youtube");
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
    usage: "<song name | YouTube link | number from .yts>",
    examples: [".play adele hello", ".song https://youtu.be/…", ".yts adele then .play 2"],
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
    usage: "<search | YouTube link | number from .yts>",
    run: youtube("video"),
  },
  {
    ...base,
    name: "yts",
    aliases: ["ytsearch", "search"],
    description: "Searches YouTube and lists the top results. Then send .play <number> or .video <number> to download one.",
    usage: "<search>",
    examples: [".yts amr diab tamally maak", ".yts lofi beats"],
    cooldown: 10,
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}yts <search>`);
      await ctx.react("🔎");
      const results = await ytdlp.search(ctx.config, ctx.text, 8);
      if (!results.length) return ctx.reply(`No YouTube results for "${ctx.text}".`);
      ytdlp.rememberSearch(ctx, results);
      const lines = results.map(
        (r, i) => `*${i + 1}.* ${r.title}\n    ⏱️ ${duration(r.seconds)} · 👁️ ${views(r.views)}${r.channel ? ` · ${r.channel}` : ""}\n    ${r.url}`,
      );
      const p = ctx.prefix;
      const how = ctx.app.capabilities.ffmpeg ? `${p}play <number> for audio · ${p}video <number> for video` : `${p}video <number> to download`;
      return ctx.reply(`🔎 *YouTube: ${ctx.text.slice(0, 60)}*\n\n${lines.join("\n\n")}\n\n${how}`);
    },
  },
];
