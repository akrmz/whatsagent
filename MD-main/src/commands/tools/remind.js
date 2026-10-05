"use strict";

const reminders = require("../../services/reminders");
const { formatInZone } = require("../../services/geo");

module.exports = {
  name: "remind",
  aliases: ["reminder", "remindme"],
  category: "tools",
  description: "Reminds you in this chat after a delay (s, m, h, d, w; up to 60 days). Survives bot restarts.",
  usage: "<when> <text> | list | del <id> | clear",
  examples: [".remind 10m check the oven", ".remind 1h30m call mom", ".remind 2d pay rent", ".remind list", ".remind del 3"],
  cooldown: 3,

  async run(ctx) {
    const [sub, arg] = ctx.args;
    const p = `${ctx.prefix}${ctx.commandName}`;
    const zone = ctx.config.bot.timezone;

    if (!sub) return ctx.reply(`Usage: ${p} 10m <text>\nAlso: ${p} list · ${p} del <id> · ${p} clear`);

    if (/^list$/i.test(sub)) {
      const mine = reminders.listFor(ctx.state, ctx.sender);
      if (!mine.length) return ctx.reply("You have no reminders.");
      const lines = mine.map((r) => `#${r.id} · ${formatInZone(new Date(r.due), zone, { year: undefined })} (in ${reminders.formatDuration(r.due - Date.now())})\n   ${r.text.slice(0, 80)}`);
      return ctx.reply(`⏰ *Your reminders*\n\n${lines.join("\n")}`);
    }
    if (/^(del|delete|rm|remove|cancel)$/i.test(sub)) {
      const id = Number(String(arg || "").replace("#", ""));
      if (!Number.isInteger(id)) return ctx.reply(`Usage: ${p} del <id>  (see ${p} list)`);
      return ctx.reply(reminders.remove(ctx.state, ctx.sender, id) ? `🗑️ Reminder #${id} deleted.` : `You have no reminder #${id}.`);
    }
    if (/^clear$/i.test(sub)) {
      const n = reminders.clearFor(ctx.state, ctx.sender);
      return ctx.reply(n ? `🗑️ Deleted ${n} reminder(s).` : "You have no reminders.");
    }

    const parsed = reminders.parseDuration(ctx.text);
    if (!parsed) return ctx.reply(`I couldn't read the time. Start with a delay like 10m, 2h or 1d.\nExample: ${p} 30m drink water`);
    const item = reminders.add(ctx.state, { chat: ctx.chatId, sender: ctx.sender, text: parsed.rest, ms: parsed.ms });
    return ctx.reply(`✅ Reminder #${item.id} set for ${formatInZone(new Date(item.due), zone)} (in ${reminders.formatDuration(parsed.ms)}).`);
  },
};
