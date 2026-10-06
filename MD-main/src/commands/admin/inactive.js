"use strict";

const activity = require("../../services/activity");
const { isBot } = require("../../services/targets");

const num = (jid) => `+${String(jid).split("@")[0].split(":")[0]}`;

module.exports = {
  name: "inactive",
  aliases: ["silent", "ghosts"],
  category: "admin",
  description: "Lists members who haven't written in this group for N days (default 7). Nobody is mentioned or notified. Counting starts when the bot first sees the group.",
  usage: "[days]",
  examples: [".inactive", ".inactive 30"],
  permission: "groupAdmin",
  cooldown: 10,
  async run(ctx) {
    const days = ctx.args[0] ? Number(ctx.args[0]) : 7;
    if (!Number.isInteger(days) || days < 1 || days > 365) return ctx.reply(`Usage: ${ctx.prefix}inactive [days 1-365]`);
    const meta = await ctx.groupMetadata();
    const participants = (meta?.participants || []).filter((p) => !isBot(ctx, p.id));
    const list = activity.inactive(ctx.state, ctx.chatId, participants, days, (j) => ctx.app.identity.aliases(j));
    const since = activity.since(ctx.state, ctx.chatId);
    const tracked = since ? `Activity is tracked since ${new Date(since).toISOString().slice(0, 10)}.` : "Activity tracking starts now.";
    if (!list.length) return ctx.reply(`✅ Everyone wrote in the last ${days} day(s).\n_${tracked}_`);
    const fmt = (m) => {
      const when = m.last ? `${Math.floor((Date.now() - m.last) / 86400000)}d ago` : "never";
      return `• ${num(ctx.app.identity.toPn(m.jid) || m.jid)}${m.admin ? " 👮" : ""} — ${when}`;
    };
    // Plain numbers, no mentions: listing people shouldn't ping them.
    const shown = list.slice(0, 80).map(fmt);
    const more = list.length > 80 ? `\n… and ${list.length - 80} more` : "";
    return ctx.reply(`💤 *Inactive for ${days}+ day(s)*: ${list.length} of ${participants.length}\n\n${shown.join("\n")}${more}\n\n_${tracked}_`);
  },
};
