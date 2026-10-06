"use strict";

const { groupData } = require("../../services/settings");
const { resolveTargets, at } = require("../../services/targets");
const { linkPhones } = require("../../services/identity-sync");
const { isPn } = require("../../core/identity");

/** One line per person, whichever forms (phone number, LID) are stored. */
function people(identity, list) {
  const seen = new Set();
  const out = [];
  for (const j of list) {
    if (seen.has(j)) continue;
    const forms = new Set([j, ...identity.aliases(j)]);
    for (const k of list) if (identity.aliases(k).some((a) => forms.has(a))) forms.add(k);
    forms.forEach((f) => seen.add(f));
    const pn = [...forms].find(isPn);
    out.push(pn ? `+${pn.split("@")[0]}${[...forms].some((f) => f.endsWith("@lid")) ? " ✓" : ""}` : `${[...forms][0]} (LID only)`);
  }
  return out;
}

module.exports = {
  name: "sudo",
  category: "owner",
  description:
    "Manages sudo users. Sudo users can moderate any group the bot administers and use ban/unban, but cannot change owner settings or add other sudo users. Both their phone number and WhatsApp's hidden id (LID) are saved, so they are recognized however WhatsApp sends their messages.",
  usage: "add <@user|number> | del <@user|number> | list",
  examples: [".sudo add @friend", ".sudo add 201012345678", ".sudo list"],
  permission: "owner",

  async run(ctx) {
    const store = groupData(ctx.state);
    const sub = (ctx.args[0] || "").toLowerCase();
    if (sub === "list") {
      const list = store.data.sudo || [];
      if (!list.length) return ctx.reply("No sudo users set.");
      const lines = people(ctx.app.identity, list);
      return ctx.reply(`*Sudo users:*\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n✓ = recognized by phone number and LID`);
    }
    if (!["add", "del", "remove"].includes(sub)) {
      return ctx.reply(`Usage:\n${ctx.prefix}sudo add <@user|number>\n${ctx.prefix}sudo del <@user|number>\n${ctx.prefix}sudo list`);
    }
    const targets = resolveTargets(ctx);
    if (!targets.length) return ctx.reply("Mention the user, reply to their message, or give their number with country code.");
    if (sub === "add") {
      // Ask WhatsApp for the LID of a number now, so the user is recognized right away.
      await linkPhones(ctx.sock, ctx.app.identity, targets).catch(() => 0);
      const forms = [...new Set(targets.flatMap((t) => ctx.app.identity.aliases(t)))];
      store.update((d) => {
        d.sudo ||= [];
        for (const f of forms) if (!d.sudo.includes(f)) d.sudo.push(f);
      });
      return ctx.send({ text: `✅ Added sudo: ${targets.map(at).join(", ")}`, mentions: targets });
    }
    const aliases = new Set(targets.flatMap((t) => ctx.app.identity.aliases(t)));
    store.update((d) => (d.sudo = (d.sudo || []).filter((j) => !aliases.has(j) && !ctx.app.identity.aliases(j).some((a) => aliases.has(a)))));
    return ctx.send({ text: `✅ Removed sudo: ${targets.map(at).join(", ")}`, mentions: targets });
  },
};
