"use strict";

const { resolveTargets, at } = require("../../services/targets");

const COMPLIMENTS = [
  "You're amazing just the way you are!",
  "You have a great sense of humor!",
  "You're incredibly thoughtful and kind.",
  "You light up the room!",
  "You're a true friend.",
  "Your creativity knows no bounds!",
  "You have a heart of gold.",
  "Your positivity is contagious!",
  "You bring out the best in people.",
  "Your kindness makes the world a better place.",
  "You are capable of achieving great things.",
  "You're stronger than you think!",
];

const INSULTS = [
  "You're like a cloud. When you disappear, it's a beautiful day!",
  "I'd agree with you, but then we'd both be wrong.",
  "Your secrets are always safe with me. I never even listen to them.",
  "You're like a software update. Whenever I see you, I think, 'Do I really need this right now?'",
  "You're the reason they put directions on shampoo bottles.",
  "You're like a Wi-Fi signal—always weak when needed most.",
  "Your brain's running Windows 95—slow and outdated.",
  "You're not lazy; you're just highly motivated to do nothing.",
];

const TRAITS = [
  "Intelligent", "Creative", "Determined", "Ambitious", "Caring", "Charismatic", "Confident", "Empathetic",
  "Energetic", "Friendly", "Generous", "Honest", "Humorous", "Imaginative", "Independent", "Kind", "Logical",
  "Loyal", "Optimistic", "Passionate", "Patient", "Reliable", "Sincere", "Wise",
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const needTarget = (ctx, verb) => ctx.reply(`Mention someone or reply to their message to ${verb} them!`);

module.exports = [
  {
    name: "compliment",
    category: "fun",
    description: "Compliments someone.",
    usage: "@user | (reply)",
    async run(ctx) {
      const who = resolveTargets(ctx, { allowNumbers: false })[0];
      if (!who) return needTarget(ctx, "compliment");
      return ctx.send({ text: `Hey ${at(who)}, ${pick(COMPLIMENTS)}`, mentions: [who] });
    },
  },
  {
    name: "insult",
    category: "fun",
    description: "Teases someone with a light-hearted roast.",
    usage: "@user | (reply)",
    async run(ctx) {
      const who = resolveTargets(ctx, { allowNumbers: false })[0];
      if (!who) return needTarget(ctx, "roast");
      return ctx.send({ text: `Hey ${at(who)}, ${pick(INSULTS)}`, mentions: [who] });
    },
  },
  {
    name: "character",
    category: "fun",
    description: "A random, just-for-fun 'character analysis' of someone.",
    usage: "@user | (reply)",
    async run(ctx) {
      const who = resolveTargets(ctx, { allowNumbers: false })[0];
      if (!who) return needTarget(ctx, "analyse");
      const traits = [...new Set(Array.from({ length: 5 }, () => pick(TRAITS)))].slice(0, 3 + Math.floor(Math.random() * 3));
      const text = [
        "🔮 *Character analysis* 🔮",
        "",
        `👤 ${at(who)}`,
        "",
        ...traits.map((t) => `✨ ${t}: ${60 + Math.floor(Math.random() * 41)}%`),
        "",
        `🎯 Overall: ${80 + Math.floor(Math.random() * 21)}%`,
        "_Just for fun — don't take it seriously!_",
      ].join("\n");
      return ctx.send({ text, mentions: [who] });
    },
  },
  {
    name: "ship",
    category: "fun",
    description: "Pairs two random group members.",
    groupOnly: true,
    async run(ctx) {
      const { participants } = await ctx.groupMetadata();
      const ids = participants.map((p) => p.id);
      if (ids.length < 2) return ctx.reply("Not enough members to ship!");
      const a = pick(ids);
      let b = pick(ids);
      while (b === a) b = pick(ids);
      return ctx.send({ text: `${at(a)} ❤️ ${at(b)}\nCongratulations 💖🍻`, mentions: [a, b] });
    },
  },
];
