"use strict";

const { getText } = require("../../core/context");

module.exports = {
  name: "ai",
  aliases: ["gpt", "gemini", "ask", "claude"],
  category: "ai",
  description: "Asks the AI a question (Claude). Reply to a message to ask about it, or send/reply to a photo or sticker to ask about the image.",
  usage: "<question>",
  examples: [".ai write a haiku about Cairo", ".gpt explain recursion simply", "(reply to a photo) .ai what is written here?"],
  cooldown: 15,
  requires: ["ai"],
  externalService: "Anthropic Claude API (your question, and the image if any, is sent)",

  async run(ctx) {
    const media = ctx.findMedia({ types: ["image", "sticker"] });
    const quoted = ctx.quoted ? getText(ctx.quoted.message) : "";
    let question = [quoted && `Message being discussed:\n"""${quoted}"""`, ctx.text].filter(Boolean).join("\n\n");
    if (!question && media) question = "Describe this image. If it contains text, transcribe it.";
    if (!question) return ctx.reply(`Please ask a question, e.g. ${ctx.prefix}ai write a basic HTML page`);
    await ctx.react("🤖");
    const images = media ? [await ctx.download(media, 10 * 1024 * 1024)] : [];
    const answer = await ctx.app.ai.ask(question, {
      images,
      system: `You are ${ctx.config.bot.name}, a helpful assistant answering inside WhatsApp. Be accurate and concise. Reply in the language of the question. Use WhatsApp formatting (*bold*, _italic_) sparingly; no Markdown headings or tables.`,
    });
    return ctx.reply(answer);
  },
};
