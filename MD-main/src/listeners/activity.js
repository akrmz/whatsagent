"use strict";

const activity = require("../services/activity");

/** Remembers when each member last wrote in a group (for .inactive). */
module.exports = {
  name: "activity",
  event: "message",
  phase: "pre",
  priority: 32,
  groupOnly: true,
  async run(ctx) {
    if (!ctx.fromMe) activity.seen(ctx.state, ctx.chatId, ctx.sender);
  },
};
