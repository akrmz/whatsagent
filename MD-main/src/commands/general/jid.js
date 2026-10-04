"use strict";

module.exports = {
  name: "jid",
  category: "general",
  description: "Shows this group's ID (JID).",
  groupOnly: true,

  async run(ctx) {
    await ctx.reply(`✅ Group JID: ${ctx.chatId}`);
  },
};
