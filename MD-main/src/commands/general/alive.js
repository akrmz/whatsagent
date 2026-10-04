"use strict";

const { version } = require("../../../package.json");

module.exports = {
  name: "alive",
  category: "general",
  description: "Shows that the bot is running, its version and current mode.",
  cooldown: 5,

  async run(ctx) {
    const mode = ctx.state.isPublic() ? "Public" : "Private";
    await ctx.reply(
      `*🤖 ${ctx.config.bot.name} is active!*\n\n*Version:* ${version}\n*Status:* Online\n*Mode:* ${mode}\n\nType *${ctx.prefix}menu* for the command list.`,
    );
  },
};
