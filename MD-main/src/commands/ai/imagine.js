"use strict";

const usage = require("../../services/aiusage");
const { toPng } = require("../../core/media");

// A picture costs much more than a text answer; count it as several requests.
const IMAGE_COST = 5;

module.exports = {
  name: "imagine",
  aliases: ["draw", "genimg", "dalle", "nanobanana"],
  category: "ai",
  description:
    "Draws a picture from your description with AI (Gemini or OpenAI, whichever key the owner set). Reply to a picture to edit it instead (Gemini only), e.g. \"make it a cartoon\".",
  usage: "<description> (or reply to a picture)",
  examples: [".imagine a cat astronaut on the moon, watercolor", "(reply to a photo) .imagine make the sky purple"],
  cooldown: 30,
  requires: ["aiImage"],
  externalService: "Google Gemini or OpenAI (your description, and the picture if any, is sent)",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}imagine <what to draw>, or reply to a picture with ${ctx.prefix}imagine <how to change it>`);
    const media = ctx.findMedia({ types: ["image", "sticker"] });
    usage.takeQuota(ctx, IMAGE_COST);
    await ctx.react("🎨");
    let image;
    if (media) {
      image = await ctx.download(media, 10 * 1024 * 1024);
      if (media.type === "sticker") image = await toPng(image);
    }
    const out = await ctx.app.media.imagine(ctx.text, { image });
    const caption = `🎨 ${ctx.text.slice(0, 200)}${out.text ? `\n\n${out.text.slice(0, 500)}` : ""}`;
    return ctx.reply({ image: out.buffer, mimetype: out.mimetype, caption });
  },
};
