"use strict";

const { getJson } = require("../../core/http");

const MAX_CHARS = 4000;

module.exports = {
  name: "lyrics",
  category: "general",
  description: "Finds the lyrics of a song.",
  usage: "<song title and/or artist>",
  examples: [".lyrics adele hello"],
  cooldown: 10,
  externalService: "lrclib.net",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`🔍 Usage: ${ctx.prefix}lyrics <song name>`);
    const results = await getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(ctx.text.slice(0, 120))}`, {
      headers: { "user-agent": "whatsapp-bot (https://lrclib.net)" },
    });
    const hit = (Array.isArray(results) ? results : []).find((r) => r.plainLyrics);
    if (!hit) return ctx.reply("❌ Sorry, I couldn't find lyrics for that song.");
    const lyrics = hit.plainLyrics.length > MAX_CHARS ? `${hit.plainLyrics.slice(0, MAX_CHARS - 3)}...` : hit.plainLyrics;
    return ctx.reply(`🎵 *${hit.trackName}* — ${hit.artistName}\n\n${lyrics}`);
  },
};
