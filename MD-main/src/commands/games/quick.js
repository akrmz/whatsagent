"use strict";

const crypto = require("node:crypto");
const quiz = require("../../services/quiz");
const { at } = require("../../services/targets");

const RPS = { rock: "🪨", paper: "📄", scissors: "✂️" };
const RPS_ALIASES = { r: "rock", stone: "rock", p: "paper", s: "scissors", scissor: "scissors", "🪨": "rock", "📄": "paper", "✂️": "scissors", حجر: "rock", ورقة: "paper", مقص: "scissors" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const POINTS = { easy: 1, medium: 2, hard: 3 };

module.exports = [
  {
    name: "rps",
    aliases: ["rockpaperscissors"],
    category: "games",
    description: "Rock, paper, scissors against the bot.",
    usage: "<rock|paper|scissors>",
    examples: [".rps rock", ".rps ✂️"],
    cooldown: 3,
    async run(ctx) {
      const raw = (ctx.args[0] || "").toLowerCase();
      const you = RPS[raw] ? raw : RPS_ALIASES[raw];
      if (!you) return ctx.reply(`Usage: ${ctx.prefix}rps rock | paper | scissors`);
      const bot = Object.keys(RPS)[crypto.randomInt(3)];
      const result = you === bot ? "🤝 Draw!" : BEATS[you] === bot ? "🎉 You win!" : "😎 I win!";
      return ctx.reply(`You: ${RPS[you]}  vs  Me: ${RPS[bot]}\n${result}`);
    },
  },
  {
    name: "mathquiz",
    aliases: ["quiz", "mquiz"],
    category: "games",
    description: "A quick maths question: the first person to send the right number within 30 seconds wins points (easy 1, medium 2, hard 3). \".mathquiz top\" shows the leaderboard.",
    usage: "[easy|medium|hard|top]",
    examples: [".mathquiz", ".mathquiz hard", ".mathquiz top"],
    cooldown: 5,
    async run(ctx) {
      const arg = (ctx.args[0] || "easy").toLowerCase();
      if (arg === "top") {
        const top = quiz.leaderboard(ctx.state, ctx.chatId);
        if (!top.length) return ctx.reply("No scores here yet. Start with .mathquiz");
        return ctx.reply({ text: `🏆 *Math quiz*\n\n${top.map(([u, n], i) => `${i + 1}. ${at(u)} — ${n}`).join("\n")}`, mentions: top.map(([u]) => u) });
      }
      if (!quiz.LEVELS[arg]) return ctx.reply(`Usage: ${ctx.prefix}mathquiz [easy|medium|hard|top]`);
      // Both quizzes take plain numbers as answers: one at a time per chat.
      if (require("../../services/quranquiz").active(ctx.chatId)) return ctx.reply("A Quran quiz question is running here; wait for it to finish.");
      const round = quiz.start(ctx.chatId, arg);
      if (!round) return ctx.reply(`A question is already running: *${quiz.active(ctx.chatId).q} = ?*`);
      setTimeout(() => {
        // Nobody answered in time: end this round and give the answer.
        if (quiz.expire(ctx.chatId, round)) ctx.send(`⏰ Time's up! *${round.q} = ${round.a}*`).catch(() => {});
      }, quiz.ROUND_MS).unref?.();
      return ctx.send(`🧮 *${round.q} = ?*\n_First correct answer within 30 s wins ${POINTS[arg]} point(s)._`);
    },
  },
];

module.exports.POINTS = POINTS;
