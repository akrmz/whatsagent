"use strict";

const { spamRules, DEFAULT_RULE } = require("../../listeners/antispam");

const ACTIONS = ["delete", "warn", "kick"];

module.exports = {
  name: "antispam",
  aliases: ["antiflood"],
  category: "admin",
  description: "Stops flooding: when a member sends more than N messages in S seconds, the extra messages are deleted and the member is warned or removed. Admins are never affected.",
  usage: "on | off | set <messages> <seconds> | action <delete|warn|kick> | get",
  examples: [".antispam on", ".antispam set 6 10", ".antispam action warn"],
  permission: "groupAdmin",
  botAdmin: true,
  cooldown: 5,

  async run(ctx) {
    const store = spamRules(ctx.state);
    const current = store.data[ctx.chatId] || { ...DEFAULT_RULE, enabled: false };
    const [sub, a, b] = ctx.args.map((x) => x.toLowerCase());
    const show = (r) => `Anti-spam: ${r.enabled ? "ON" : "OFF"} · more than ${r.max} messages in ${r.seconds}s → ${r.action}`;
    const p = `${ctx.prefix}antispam`;

    if (sub === "on" || sub === "off") {
      store.update((d) => (d[ctx.chatId] = { ...current, enabled: sub === "on" }));
      return ctx.reply(`✅ ${show({ ...current, enabled: sub === "on" })}`);
    }
    if (sub === "set") {
      const max = Number(a);
      const seconds = Number(b);
      if (!Number.isInteger(max) || max < 3 || max > 50 || !Number.isInteger(seconds) || seconds < 3 || seconds > 120) {
        return ctx.reply(`Usage: ${p} set <messages 3-50> <seconds 3-120>, e.g. ${p} set 6 10`);
      }
      const next = { ...current, enabled: true, max, seconds };
      store.update((d) => (d[ctx.chatId] = next));
      return ctx.reply(`✅ ${show(next)}`);
    }
    if (sub === "action") {
      if (!ACTIONS.includes(a)) return ctx.reply(`Choose: ${ACTIONS.join(", ")}`);
      const next = { ...current, action: a };
      store.update((d) => (d[ctx.chatId] = next));
      return ctx.reply(`✅ ${show(next)}`);
    }
    if (sub === "get") return ctx.reply(show(current));
    return ctx.reply(`*ANTI-SPAM*\n\n${show(current)}\n\n${p} on | off\n${p} set <messages> <seconds>\n${p} action ${ACTIONS.join(" | ")}`);
  },
};
