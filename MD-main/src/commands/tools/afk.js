"use strict";

const afk = require("../../services/afk");

module.exports = {
  name: "afk",
  aliases: ["away"],
  category: "tools",
  description: "Marks you as away. When someone mentions or replies to you, the bot tells them; your next message clears it.",
  usage: "[reason]",
  examples: [".afk sleeping", ".afk"],
  cooldown: 10,

  async run(ctx) {
    afk.set(ctx.app, ctx.sender, ctx.text);
    return ctx.reply(`💤 You are now AFK${ctx.text ? `: ${ctx.text.slice(0, 200)}` : "."}\nSend any message to come back.`);
  },
};
