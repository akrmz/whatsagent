"use strict";

const { files } = require("../../services/settings");
const { resolveTargets, isBot, at } = require("../../services/targets");

module.exports = [
  {
    name: "ban",
    category: "admin",
    description: "Stops a user from using the bot anywhere. Owners can never be banned.",
    usage: "@user | (reply) | <number>",
    examples: [".ban @someone"],
    permission: "sudo",

    async run(ctx) {
      const targets = resolveTargets(ctx);
      if (!targets.length) return ctx.reply("Mention the user, reply to their message, or give their number.");
      const added = [];
      for (const t of targets) {
        if (isBot(ctx, t) || ctx.app.permissions.isOwner(t)) continue;
        files.banned(ctx.state).update((list) => {
          if (!list.includes(t)) {
            list.push(t);
            added.push(t);
          }
        });
      }
      if (!added.length) return ctx.reply("Nobody was banned (already banned, the bot, or an owner).");
      return ctx.send({ text: `🚫 Banned: ${added.map(at).join(", ")}`, mentions: added });
    },
  },
  {
    name: "unban",
    category: "admin",
    description: "Allows a banned user to use the bot again.",
    usage: "@user | (reply) | <number>",
    permission: "sudo",

    async run(ctx) {
      const targets = resolveTargets(ctx);
      if (!targets.length) return ctx.reply("Mention the user, reply to their message, or give their number.");
      const aliases = new Set(targets.flatMap((t) => ctx.app.identity.aliases(t)));
      const removed = files.banned(ctx.state).update((list) => {
        const before = list.length;
        for (let i = list.length - 1; i >= 0; i--) if (aliases.has(list[i])) list.splice(i, 1);
        return before - list.length;
      });
      return ctx.send({
        text: removed ? `✅ Unbanned: ${targets.map(at).join(", ")}` : `${targets.map(at).join(", ")} was not banned.`,
        mentions: targets,
      });
    },
  },
];
