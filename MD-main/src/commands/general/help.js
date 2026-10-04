"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderMenu, renderCommand } = require("../../services/help");
const { version } = require("../../../package.json");

const BANNER = path.join(__dirname, "..", "..", "..", "assets", "bot_image.jpg");

module.exports = {
  name: "help",
  aliases: ["menu", "bot", "list"],
  category: "general",
  description: "Lists all commands, or explains one command in detail.",
  usage: "[command]",
  examples: [".help", ".help sticker"],
  cooldown: 5,

  async run(ctx) {
    const { commands } = ctx.app;
    const prefix = ctx.prefix;
    if (ctx.args[0]) {
      const wanted = ctx.args[0].replace(prefix, "").toLowerCase();
      const command = commands.byName.get(wanted);
      if (!command || command.hidden) return ctx.reply(`No command named ${prefix}${wanted}. Send ${prefix}help for the list.`);
      return ctx.reply(renderCommand(command, prefix));
    }
    const text = renderMenu({ commands: commands.list, prefix, botName: ctx.config.bot.name, version });
    if (fs.existsSync(BANNER)) return ctx.reply({ image: fs.readFileSync(BANNER), caption: text });
    return ctx.reply(text);
  },
};
