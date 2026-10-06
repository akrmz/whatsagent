"use strict";

const linkAllow = require("../../services/linkallow");

module.exports = {
  name: "linkallow",
  aliases: ["allowlink", "antilinkallow"],
  category: "admin",
  description: "Domains antilink lets through in this group (subdomains included). Without arguments, lists them.",
  usage: "[add|remove] <domain>",
  examples: [".linkallow youtube.com", ".linkallow remove youtube.com", ".linkallow"],
  permission: "groupAdmin",
  cooldown: 3,
  async run(ctx) {
    const [first, second] = ctx.args;
    if (!first) {
      const all = linkAllow.list(ctx.state, ctx.chatId);
      return ctx.reply(all.length ? `✅ Allowed links here:\n${all.map((d) => `• ${d}`).join("\n")}` : `No allowed domains. Add one: ${ctx.prefix}linkallow youtube.com`);
    }
    if (/^(remove|rm|del|delete)$/i.test(first)) {
      if (!second) return ctx.reply(`Usage: ${ctx.prefix}linkallow remove <domain>`);
      return ctx.reply(linkAllow.remove(ctx.state, ctx.chatId, second) ? `🗑️ ${linkAllow.normalize(second)} is no longer allowed.` : "That domain was not on the list.");
    }
    const domain = linkAllow.add(ctx.state, ctx.chatId, /^add$/i.test(first) ? second : first);
    return ctx.reply(`✅ Links to ${domain} are allowed here (antilink ignores them).`);
  },
};
