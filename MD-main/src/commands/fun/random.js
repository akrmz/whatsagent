"use strict";

const crypto = require("node:crypto");

const DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

module.exports = [
  {
    name: "roll",
    aliases: ["dice"],
    category: "fun",
    description: "Rolls dice: 1 six-sided die by default, or NdM (up to 20 dice with up to 1000 sides).",
    usage: "[NdM]",
    examples: [".roll", ".roll 2d6", ".roll d20"],
    cooldown: 3,
    async run(ctx) {
      const m = (ctx.args[0] || "1d6").toLowerCase().match(/^(\d{0,2})d(\d{1,4})$/);
      const n = m ? Number(m[1] || 1) : 0;
      const sides = m ? Number(m[2]) : 0;
      if (!m || n < 1 || n > 20 || sides < 2 || sides > 1000) return ctx.reply(`Usage: ${ctx.prefix}roll 2d6  (1-20 dice, 2-1000 sides)`);
      const rolls = Array.from({ length: n }, () => 1 + crypto.randomInt(sides));
      const shown = sides === 6 ? rolls.map((r) => `${DICE[r - 1]} ${r}`).join("  ") : rolls.join(", ");
      return ctx.reply(`🎲 ${shown}${n > 1 ? `\nTotal: *${rolls.reduce((a, b) => a + b, 0)}*` : ""}`);
    },
  },
  {
    name: "flip",
    aliases: ["coin", "coinflip"],
    category: "fun",
    description: "Flips a coin.",
    cooldown: 3,
    async run(ctx) {
      return ctx.reply(crypto.randomInt(2) ? "🪙 *Heads*" : "🪙 *Tails*");
    },
  },
  {
    name: "pick",
    aliases: ["choose", "choice"],
    category: "fun",
    description: "Picks one option at random. Separate options with commas or |.",
    usage: "<option 1>, <option 2>, …",
    examples: [".pick pizza, koshary, shawarma"],
    cooldown: 3,
    async run(ctx) {
      const options = ctx.text.split(/[,|،]/).map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) return ctx.reply(`Usage: ${ctx.prefix}pick pizza, burger, sushi`);
      return ctx.reply(`🎯 I pick: *${options[crypto.randomInt(options.length)]}*`);
    },
  },
  {
    name: "random",
    aliases: ["rand", "rng"],
    category: "fun",
    description: "Random whole number between two numbers (1-100 by default).",
    usage: "[min] [max]",
    examples: [".random", ".random 1 10"],
    cooldown: 3,
    async run(ctx) {
      const [a, b] = ctx.args.map(Number);
      const min = ctx.args.length >= 2 ? Math.min(a, b) : 1;
      const max = ctx.args.length >= 2 ? Math.max(a, b) : ctx.args.length === 1 ? a : 100;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max - min < 1 || max - min > 2 ** 47) {
        return ctx.reply(`Usage: ${ctx.prefix}random <min> <max>`);
      }
      return ctx.reply(`🔢 *${min + crypto.randomInt(max - min + 1)}*  (${min}–${max})`);
    },
  },
];
