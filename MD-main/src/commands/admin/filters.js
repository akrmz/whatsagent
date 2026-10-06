"use strict";

const filters = require("../../services/filters");
const { getText } = require("../../core/context");

const base = { category: "admin", permission: "groupAdmin", cooldown: 3 };

module.exports = [
  {
    ...base,
    name: "filter",
    aliases: ["autoreply", "addfilter"],
    description: "Adds an auto-reply: when someone writes the trigger word or phrase, the bot answers with your text. Or reply to a message to use it as the answer.",
    usage: "<trigger> | <reply>",
    examples: [".filter hello | Welcome to the group! 👋", ".filter rules | Read the description please", "(reply to a message) .filter price"],
    async run(ctx) {
      const [trigger, ...rest] = ctx.text.split("|");
      const reply = rest.join("|").trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");
      if (!trigger?.trim() || !reply) return ctx.reply(`Usage: ${ctx.prefix}filter <trigger> | <reply>\nExample: ${ctx.prefix}filter hello | Welcome! 👋`);
      const { key, replaced } = filters.add(ctx.state, ctx.chatId, trigger, reply, ctx.sender);
      return ctx.reply(`✅ Auto-reply for "${key}" ${replaced ? "updated" : "added"}.`);
    },
  },
  {
    ...base,
    name: "stopfilter",
    aliases: ["delfilter", "rmfilter"],
    description: "Removes an auto-reply (\".stopfilter all\" removes every one).",
    usage: "<trigger | all>",
    async run(ctx) {
      const trigger = ctx.text.trim();
      if (!trigger) return ctx.reply(`Usage: ${ctx.prefix}stopfilter <trigger>`);
      if (trigger.toLowerCase() === "all") {
        const all = filters.list(ctx.state, ctx.chatId);
        all.forEach((t) => filters.remove(ctx.state, ctx.chatId, t));
        return ctx.reply(all.length ? `🗑️ Removed ${all.length} auto-replies.` : "There are no auto-replies here.");
      }
      return ctx.reply(filters.remove(ctx.state, ctx.chatId, trigger) ? `🗑️ Auto-reply "${trigger.toLowerCase()}" removed.` : "There is no such auto-reply.");
    },
  },
  {
    name: "filters",
    aliases: ["autoreplies"],
    category: "admin",
    description: "Lists this group's auto-replies.",
    groupOnly: true,
    cooldown: 5,
    async run(ctx) {
      const all = filters.list(ctx.state, ctx.chatId);
      if (!all.length) return ctx.reply(`No auto-replies here. Add one: ${ctx.prefix}filter <trigger> | <reply>`);
      return ctx.reply(`💬 *Auto-replies* (${all.length})\n\n${all.map((t) => `• ${t}`).join("\n")}`);
    },
  },
];
