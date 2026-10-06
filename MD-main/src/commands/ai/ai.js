"use strict";

const { getText } = require("../../core/context");
const usage = require("../../services/aiusage");

const memoryKey = (ctx) => `ai|${ctx.chatId}|${ctx.sender}`;

module.exports = [
  {
    name: "ai",
    aliases: ["gpt", "gemini", "ask", "claude"],
    category: "ai",
    description:
      "Asks the AI (Claude, Gemini or an OpenAI-compatible model — the owner picks it with .setai). It remembers your last few questions for 30 minutes, so you can ask follow-ups. Reply to a message to ask about it, or send/reply to a photo or sticker to ask about the picture.",
    usage: "<question>",
    examples: [".ai write a haiku about Cairo", ".ai make it funnier", "(reply to a photo) .ai what is written here?"],
    cooldown: 10,
    requires: ["ai"],
    externalService: "the configured AI provider: Anthropic, Google or OpenAI-compatible (your question, and the image if any, is sent)",

    async run(ctx) {
      const media = ctx.findMedia({ types: ["image", "sticker"] });
      const quoted = ctx.quoted ? getText(ctx.quoted.message) : "";
      let question = [quoted && `Message being discussed:\n"""${quoted}"""`, ctx.text].filter(Boolean).join("\n\n");
      if (!question && media) question = "Describe this image. If it contains text, transcribe it.";
      if (!question) return ctx.reply(`Please ask a question, e.g. ${ctx.prefix}ai write a basic HTML page`);
      usage.takeQuota(ctx);
      await ctx.react("🤖");
      const turns = ctx.config.ai.memoryTurns;
      const images = media ? [await ctx.download(media, 10 * 1024 * 1024)] : [];
      const answer = await ctx.app.ai.ask(question, {
        images,
        history: usage.history(memoryKey(ctx), turns),
        system: `You are ${ctx.config.bot.name}, a helpful assistant answering inside WhatsApp. Be accurate and concise. Reply in the language of the question. Use WhatsApp formatting (*bold*, _italic_) sparingly; no Markdown headings or tables.`,
      });
      usage.remember(memoryKey(ctx), turns, media ? `[sent a picture] ${question}` : question, answer);
      return ctx.reply(answer);
    },
  },
  {
    name: "aireset",
    aliases: ["newchat", "forget", "clearai"],
    category: "ai",
    description: "Makes .ai forget your conversation, to start a new topic. Also shows how many AI requests you have left today.",
    cooldown: 3,
    requires: ["ai"],
    async run(ctx) {
      usage.forget(memoryKey(ctx));
      const left = usage.remaining(ctx);
      return ctx.reply(`🧹 Conversation forgotten.${Number.isFinite(left) ? ` You have ${left} AI request(s) left today.` : ""}`);
    },
  },
];
