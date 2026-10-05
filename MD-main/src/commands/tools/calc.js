"use strict";

const { evaluate, formatNumber } = require("../../services/calc");

module.exports = {
  name: "calc",
  aliases: ["calculate", "math"],
  category: "tools",
  description: "Calculates a maths expression: + - * / % ^ !, brackets, sqrt, sin/cos/tan (degrees), log, ln, abs, round, min, max, pi, e.",
  usage: "<expression>",
  examples: [".calc (12+8)*3/4", ".calc sqrt(2)^2", ".calc 15% of 80", ".calc sin(30)"],
  cooldown: 3,

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}calc <expression>, e.g. ${ctx.prefix}calc 2^10`);
    // "15% of 80" → "15/100*80"
    const expr = ctx.text.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, "$1/100*");
    return ctx.reply(`🧮 ${ctx.text}\n= *${formatNumber(evaluate(expr))}*`);
  },
};
