"use strict";

const usage = require("../../services/aiusage");

module.exports = {
  name: "ocr",
  aliases: ["readtext", "img2text", "scantext"],
  category: "ai",
  description: "Reads the text in a picture (screenshots, documents, signs; any language, handwriting too) and sends it as text you can copy. Send or reply to a picture.",
  usage: "(send or reply to a picture)",
  examples: ["(reply to a picture) .ocr"],
  cooldown: 10,
  requires: ["ai"],
  externalService: "the configured AI provider (the picture is sent)",
  async run(ctx) {
    const media = ctx.findMedia({ types: ["image", "sticker", "document"] });
    if (!media || (media.type === "document" && !/^image\//.test(media.mimetype || ""))) {
      return ctx.reply(`Send a picture with ${ctx.prefix}ocr as its caption, or reply to a picture with ${ctx.prefix}ocr.`);
    }
    usage.takeQuota(ctx);
    await ctx.react("🔎");
    const image = await ctx.download(media, 10 * 1024 * 1024);
    const text = await ctx.app.ai.ask(
      "Transcribe all the text in this image exactly as written, in its original language. Keep the line breaks and the reading order. Output only the text. If there is no readable text, reply exactly: NO_TEXT",
      { images: [image], system: "You are an OCR engine. You never add comments, translations or explanations." },
    );
    if (/^\s*NO_TEXT\s*$/.test(text)) return ctx.reply("No readable text found in that picture.");
    return ctx.reply(text.trim());
  },
};
