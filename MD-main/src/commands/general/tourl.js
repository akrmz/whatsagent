"use strict";

const { uploadPublic } = require("../../services/external");

const EXT = { image: "jpg", video: "mp4", audio: "mp3", sticker: "webp", document: "bin" };

module.exports = {
  name: "tourl",
  aliases: ["url"],
  category: "general",
  description: "Uploads the media you send or reply to and returns a PUBLIC link (anyone with the link can see it).",
  usage: "(send or reply to media)",
  cooldown: 30,
  externalService: "qu.ax / uguu.se / telegra.ph (public file hosts)",

  async run(ctx) {
    const media = ctx.findMedia();
    if (!media) return ctx.reply("Send or reply to an image, video, audio, sticker or document to get a URL.");
    const buffer = await ctx.download(media);
    const ext = media.type === "document" ? (media.content.fileName || "").split(".").pop()?.slice(0, 8) || "bin" : EXT[media.type];
    const url = await uploadPublic(buffer, { filename: `file.${ext.replace(/[^\w]/g, "")}`, contentType: media.mimetype || "application/octet-stream" });
    return ctx.reply(`URL: ${url}\n\n⚠️ This link is public.`);
  },
};
