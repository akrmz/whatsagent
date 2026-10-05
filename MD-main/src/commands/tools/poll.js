"use strict";

module.exports = {
  name: "poll",
  aliases: ["vote"],
  category: "tools",
  description: "Creates a native WhatsApp poll. Separate the question and 2–12 options with |. Add \"multi\" first to allow several answers.",
  usage: "[multi] <question> | <option 1> | <option 2> …",
  examples: [".poll Pizza or burgers? | Pizza | Burgers", ".poll multi Which days work? | Mon | Tue | Wed"],
  cooldown: 10,

  async run(ctx) {
    let text = ctx.text;
    const multi = /^multi\s+/i.test(text);
    if (multi) text = text.replace(/^multi\s+/i, "");
    const parts = text.split("|").map((s) => s.trim()).filter(Boolean);
    const [question, ...options] = parts;
    const unique = [...new Set(options.map((o) => o.slice(0, 100)))];
    if (!question || unique.length < 2) {
      return ctx.reply(`Usage: ${ctx.prefix}poll <question> | <option 1> | <option 2>\nExample: ${ctx.prefix}poll Movie tonight? | Yes | No`);
    }
    if (unique.length > 12) return ctx.reply("A poll can have at most 12 options.");
    return ctx.send({ poll: { name: question.slice(0, 255), values: unique, selectableCount: multi ? 0 : 1 } });
  },
};
