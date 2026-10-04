"use strict";

const { groupData } = require("../../services/settings");
const { resolveTargets, at } = require("../../services/targets");

module.exports = {
  name: "sudo",
  category: "owner",
  description: "Manages sudo users. Sudo users can moderate any group the bot administers and use ban/unban, but cannot change owner settings or add other sudo users.",
  usage: "add <@user|number> | del <@user|number> | list",
  examples: [".sudo add @friend", ".sudo list"],
  permission: "owner",

  async run(ctx) {
    const store = groupData(ctx.state);
    const sub = (ctx.args[0] || "").toLowerCase();
    if (sub === "list") {
      const list = store.data.sudo || [];
      return ctx.reply(list.length ? `*Sudo users:*\n${list.map((j, i) => `${i + 1}. ${j}`).join("\n")}` : "No sudo users set.");
    }
    if (!["add", "del", "remove"].includes(sub)) {
      return ctx.reply(`Usage:\n${ctx.prefix}sudo add <@user|number>\n${ctx.prefix}sudo del <@user|number>\n${ctx.prefix}sudo list`);
    }
    const targets = resolveTargets(ctx);
    if (!targets.length) return ctx.reply("Mention the user, reply to their message, or give their number with country code.");
    if (sub === "add") {
      store.update((d) => {
        d.sudo ||= [];
        for (const t of targets) if (!d.sudo.includes(t)) d.sudo.push(t);
      });
      return ctx.send({ text: `✅ Added sudo: ${targets.map(at).join(", ")}`, mentions: targets });
    }
    const aliases = new Set(targets.flatMap((t) => ctx.app.identity.aliases(t)));
    store.update((d) => (d.sudo = (d.sudo || []).filter((j) => !aliases.has(j))));
    return ctx.send({ text: `✅ Removed sudo: ${targets.map(at).join(", ")}`, mentions: targets });
  },
};
