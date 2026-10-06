"use strict";

const autodl = require("../../services/autodl");

module.exports = {
  name: "autodl",
  aliases: ["autodownload", "autovideo"],
  category: "download",
  description:
    "Automatic downloads in this group: when someone posts a TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest or YouTube Shorts link, the bot replies with the video. One at a time, at most 30 an hour per group; failures only get a ❌ reaction.",
  usage: "on | off | (no argument: status)",
  examples: [".autodl on", ".autodl off"],
  permission: "groupAdmin",
  groupOnly: true,
  requires: ["ytdlp"],
  cooldown: 5,
  externalService: "the linked site, via yt-dlp (only links posted while it is on)",
  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    if (sub === "on" || sub === "off") {
      autodl.set(ctx.state, ctx.chatId, sub === "on");
      return ctx.reply(
        sub === "on"
          ? `✅ Automatic downloads are *on*. Post a video link (TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest, YouTube Shorts) and the bot sends the video. ${ctx.prefix}autodl off to stop.`
          : "⏹️ Automatic downloads are off.",
      );
    }
    return ctx.reply(
      `⏬ Automatic downloads: *${autodl.isOn(ctx.state, ctx.chatId) ? "on" : "off"}*\n${ctx.prefix}autodl on | off\n\nAnyone can still use ${ctx.prefix}dl <link>, or reply to a link with ${ctx.prefix}dl.`,
    );
  },
};
