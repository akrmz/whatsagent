"use strict";

const recap = require("../services/recap");

/** Keeps the recent text of group chats in memory for .recap (commands are skipped). */
module.exports = {
  name: "recap",
  event: "message",
  phase: "pre",
  priority: 33,
  groupOnly: true,
  requires: ["ai"],
  async run(ctx) {
    if (!ctx.body || ctx.body.startsWith(ctx.prefix)) return;
    recap.record(ctx.chatId, { name: ctx.fromMe ? ctx.config.bot.name : ctx.senderName || ctx.sender.split("@")[0], text: ctx.body });
  },
};
