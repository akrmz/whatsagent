"use strict";

const { groupData } = require("../../services/settings");

module.exports = {
  name: "chatbot",
  category: "admin",
  description: "Turns the AI chatbot on or off in this group. When on, it answers messages that mention or reply to the bot.",
  usage: "on | off",
  permission: "groupAdmin",
  requires: ["ai"],
  externalService: "Anthropic Claude API (the triggering message is sent)",

  async run(ctx) {
    const store = groupData(ctx.state);
    const sub = (ctx.args[0] || "").toLowerCase();
    const enabled = Boolean(store.data.chatbot[ctx.chatId]);
    if (sub === "on") {
      if (enabled) return ctx.reply("Chatbot is already enabled in this group.");
      store.update((d) => (d.chatbot[ctx.chatId] = true));
      return ctx.reply("✅ Chatbot enabled. Mention me or reply to my messages to chat.");
    }
    if (sub === "off") {
      if (!enabled) return ctx.reply("Chatbot is already disabled in this group.");
      store.update((d) => delete d.chatbot[ctx.chatId]);
      return ctx.reply("✅ Chatbot disabled.");
    }
    return ctx.reply(`*CHATBOT*\n\n${ctx.prefix}chatbot on\n${ctx.prefix}chatbot off\n\nStatus: ${enabled ? "ON" : "OFF"}`);
  },
};
