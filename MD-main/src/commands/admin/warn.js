"use strict";

const { files } = require("../../services/settings");
const { warnUser } = require("../../services/moderation");
const { resolveTargets, isBot, at } = require("../../services/targets");

module.exports = [
  {
    name: "warn",
    category: "admin",
    description: "Warns a member. They are removed automatically at WARN_LIMIT warnings (default 3).",
    usage: "@user | (reply)",
    permission: "groupAdmin",
    botAdmin: true,

    async run(ctx) {
      const user = resolveTargets(ctx, { allowNumbers: false })[0];
      if (!user) return ctx.reply("Mention the user or reply to their message to warn them.");
      if (isBot(ctx, user) || ctx.app.permissions.isOwner(user)) return ctx.reply("That user cannot be warned.");
      await warnUser(ctx, user, `warned by ${at(ctx.sender)}`);
      return undefined;
    },
  },
  {
    name: "warnings",
    category: "admin",
    description: "Shows how many warnings a member has in this group.",
    usage: "@user | (reply)",
    groupOnly: true,

    async run(ctx) {
      const user = resolveTargets(ctx, { allowNumbers: false })[0] || ctx.sender;
      const data = files.warnings(ctx.state).data[ctx.chatId] || {};
      const count = ctx.app.identity.aliases(user).reduce((n, a) => n + (data[a] || 0), 0);
      return ctx.send({ text: `${at(user)} has ${count}/${ctx.config.limits.warnLimit} warning(s).`, mentions: [user] });
    },
  },
];
