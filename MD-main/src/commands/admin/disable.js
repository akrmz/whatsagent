"use strict";

const groupcmds = require("../../services/groupcmds");

/** Resolves names/aliases (".sticker", "s") to command names; unknown ones are reported. */
function resolve(ctx) {
  const found = [];
  const unknown = [];
  for (const raw of ctx.args.slice(0, 30)) {
    const name = raw.replace(ctx.prefix, "").toLowerCase();
    const c = ctx.app.commands.byName.get(name);
    if (c) found.push(c.name);
    else unknown.push(raw);
  }
  return { found: [...new Set(found)], unknown };
}

const base = { category: "admin", permission: "groupAdmin", cooldown: 3 };

module.exports = [
  {
    ...base,
    name: "disable",
    aliases: ["cmdoff"],
    description: "Turns commands off in this group (for everyone except the bot owner and sudo). .help and .enable can't be turned off.",
    usage: "<command> [command …]",
    examples: [".disable sticker song", ".disable ai"],
    async run(ctx) {
      const { found, unknown } = resolve(ctx);
      if (!found.length) return ctx.reply(`Usage: ${ctx.prefix}disable <command> …${unknown.length ? `\nUnknown: ${unknown.join(", ")}` : ""}`);
      const blocked = found.filter((n) => groupcmds.PROTECTED.has(n));
      const off = found.filter((n) => !groupcmds.PROTECTED.has(n));
      if (off.length) groupcmds.setDisabled(ctx.state, ctx.chatId, off, true);
      const lines = [
        off.length ? `🚫 Turned off here: ${off.map((n) => ctx.prefix + n).join(", ")}` : "",
        blocked.length ? `Can't turn off: ${blocked.map((n) => ctx.prefix + n).join(", ")}` : "",
        unknown.length ? `Unknown: ${unknown.join(", ")}` : "",
      ];
      return ctx.reply(lines.filter(Boolean).join("\n"));
    },
  },
  {
    ...base,
    name: "enable",
    aliases: ["cmdon"],
    description: "Turns commands back on in this group. \".enable all\" turns every one back on.",
    usage: "<command …> | all",
    examples: [".enable sticker", ".enable all"],
    async run(ctx) {
      if ((ctx.args[0] || "").toLowerCase() === "all") {
        const was = groupcmds.disabledIn(ctx.state, ctx.chatId);
        groupcmds.setDisabled(ctx.state, ctx.chatId, was, false);
        return ctx.reply(was.length ? `✅ Turned back on: ${was.map((n) => ctx.prefix + n).join(", ")}` : "No commands are turned off here.");
      }
      const { found, unknown } = resolve(ctx);
      if (!found.length) return ctx.reply(`Usage: ${ctx.prefix}enable <command> … | all`);
      groupcmds.setDisabled(ctx.state, ctx.chatId, found, false);
      return ctx.reply([`✅ Turned on: ${found.map((n) => ctx.prefix + n).join(", ")}`, unknown.length ? `Unknown: ${unknown.join(", ")}` : ""].filter(Boolean).join("\n"));
    },
  },
  {
    name: "disabled",
    aliases: ["offcommands"],
    category: "admin",
    description: "Lists the commands turned off in this group.",
    groupOnly: true,
    cooldown: 5,
    async run(ctx) {
      const list = groupcmds.disabledIn(ctx.state, ctx.chatId);
      return ctx.reply(list.length ? `🚫 Turned off in this group:\n${list.map((n) => ctx.prefix + n).join(", ")}` : "No commands are turned off in this group.");
    },
  },
];
