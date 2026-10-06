"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderMenu, renderCommand, renderCategory, findCategory, suggest } = require("../../services/help");
const { version } = require("../../../package.json");

const BANNER = path.join(__dirname, "..", "..", "..", "assets", "bot_image.jpg");

module.exports = {
  name: "help",
  aliases: ["menu", "bot", "list"],
  category: "general",
  description: "Lists all commands, one section (tools, info, download, sticker …), or explains one command.",
  usage: "[command | section]",
  examples: [".help", ".help sticker", ".help tools", ".help downloads"],
  cooldown: 5,

  async run(ctx) {
    const { commands } = ctx.app;
    const prefix = ctx.prefix;
    if (ctx.args[0]) {
      const wanted = ctx.args[0].replace(prefix, "").toLowerCase();
      const command = commands.byName.get(wanted);
      if (command && !command.hidden) return ctx.reply(renderCommand(command, prefix));
      const off = commands.disabled.find((d) => d.name === wanted || (d.aliases || []).includes(wanted));
      if (off) {
        const why = ctx.isOwner ? ` It needs: ${off.missing.join(", ")} — see ${prefix}doctor.` : "";
        return ctx.reply(`⚠️ ${prefix}${off.name} isn't available on this bot right now.${why}`);
      }
      const category = findCategory(wanted, commands.list);
      if (category) return ctx.reply(renderCategory(category, commands.list, prefix));
      const close = suggest(wanted, commands.byName);
      const hint = close.length ? `\nDid you mean: ${close.map((n) => prefix + n).join(", ")}?` : "";
      return ctx.reply(`No command or section named "${wanted}".${hint}\nSend ${prefix}help for the full list.`);
    }
    const text = renderMenu({ commands: commands.list, prefix, botName: ctx.config.bot.name, version });
    if (fs.existsSync(BANNER)) return ctx.reply({ image: fs.readFileSync(BANNER), caption: text });
    return ctx.reply(text);
  },
};
