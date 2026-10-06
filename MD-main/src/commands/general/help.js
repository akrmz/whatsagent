"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { renderMenu, renderOverview, visibleFor, renderCommand, renderCategory, findCategory, suggest } = require("../../services/help");
const { version } = require("../../../package.json");

const BANNER = path.join(__dirname, "..", "..", "..", "assets", "bot_image.jpg");

module.exports = {
  name: "help",
  aliases: ["menu", "bot", "list"],
  category: "general",
  description: "A short overview of the sections; .help <section> lists one section, .help <command> explains a command, and .menu (or .help all) lists every command you can use.",
  usage: "[command | section | all]",
  examples: [".help", ".help islamic", ".help sticker", ".menu"],
  cooldown: 5,

  async run(ctx) {
    const { commands } = ctx.app;
    const prefix = ctx.prefix;
    // .menu and .help all: every command; .help: a short overview.
    const full = (ctx.commandName === "menu" && !ctx.args[0]) || /^all$/i.test(ctx.args[0] || "");
    if (ctx.args[0] && !full) {
      const wanted = ctx.args[0].replace(prefix, "").toLowerCase();
      const command = commands.byName.get(wanted);
      if (command && !command.hidden) return ctx.reply(renderCommand(command, prefix));
      const off = commands.disabled.find((d) => d.name === wanted || (d.aliases || []).includes(wanted));
      if (off) {
        const why = ctx.isOwner ? ` It needs: ${off.missing.join(", ")} — see ${prefix}doctor.` : "";
        return ctx.reply(`⚠️ ${prefix}${off.name} isn't available on this bot right now.${why}`);
      }
      const visible = visibleFor(commands.list, ctx.level);
      if (wanted !== "all") {
        const category = findCategory(wanted, visible);
        if (category) return ctx.reply(renderCategory(category, visible, prefix));
      }
      const close = suggest(wanted, commands.byName);
      const hint = close.length ? `\nDid you mean: ${close.map((n) => prefix + n).join(", ")}?` : "";
      return ctx.reply(`No command or section named "${wanted}".${hint}\nSend ${prefix}help for the full list.`);
    }
    const opts = { commands: commands.list, prefix, botName: ctx.config.bot.name, version, level: ctx.level };
    if (full) return ctx.reply(renderMenu(opts)); // long: plain text, not an image caption
    const text = renderOverview(opts);
    if (fs.existsSync(BANNER)) return ctx.reply({ image: fs.readFileSync(BANNER), caption: text });
    return ctx.reply(text);
  },
};
