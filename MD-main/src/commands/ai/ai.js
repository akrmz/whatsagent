"use strict";

const { getText } = require("../../core/context");

module.exports = {
  name: "ai",
  aliases: ["gpt", "gemini", "ask", "claude"],
  category: "ai",
  description: "Asks the AI a question (Claude). You can also reply to a message to ask about it.",
  usage: "<question>",
  examples: [".ai write a haiku about Cairo", ".gpt explain recursion simply"],
  cooldown: 15,
  requires: ["ai"],
  externalService: "Anthropic Claude API (your question is sent)",

  async run(ctx) {
    const quoted = ctx.quoted ? getText(ctx.quoted.message) : "";
    const question = [quoted && `Message being discussed:\n"""${quoted}"""`, ctx.text].filter(Boolean).join("\n\n");
    if (!question) return ctx.reply(`Please ask a question, e.g. ${ctx.prefix}ai write a basic HTML page`);
    await ctx.react("🤖");
    const answer = await ctx.app.ai.ask(question, {
      system: `You are ${ctx.config.bot.name}, a helpful assistant answering inside WhatsApp. Be accurate and concise. Use WhatsApp formatting (*bold*, _italic_) sparingly; no Markdown headings or tables.`,
    });
    return ctx.reply(answer);
  },
};
