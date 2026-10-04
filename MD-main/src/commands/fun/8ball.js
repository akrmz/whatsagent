"use strict";

const ANSWERS = [
  "Yes, definitely!",
  "No way!",
  "Ask again later.",
  "It is certain.",
  "Very doubtful.",
  "Without a doubt.",
  "My reply is no.",
  "Signs point to yes.",
];

module.exports = {
  name: "8ball",
  category: "fun",
  description: "Answers a yes/no question like a magic 8-ball.",
  usage: "<question>",
  examples: [".8ball Will it rain tomorrow?"],

  async run(ctx) {
    if (!ctx.text) return ctx.reply("Please ask a question!");
    return ctx.reply(`🎱 ${ANSWERS[Math.floor(Math.random() * ANSWERS.length)]}`);
  },
};
