"use strict";

const reminders = require("../../services/reminders");
const { formatInZone } = require("../../services/geo");

module.exports = {
  name: "remind",
  aliases: ["reminder", "remindme"],
  category: "tools",
  description:
    "Reminds you in this chat: after a delay (10m, 2h, 3d), at a time (at 18:30, tomorrow at 9am), or repeating (every day at 08:00, every 2h). Times use the bot's TIMEZONE. Survives restarts.",
  usage: "<when> <text> | list | del <id> | clear",
  examples: [".remind 10m check the oven", ".remind at 18:30 call mom", ".remind tomorrow at 9am meeting", ".remind every day at 08:00 take your pills", ".remind list", ".remind del 3"],
  cooldown: 3,

  async run(ctx) {
    const [sub, arg] = ctx.args;
    const p = `${ctx.prefix}${ctx.commandName}`;
    const zone = ctx.config.bot.timezone;
    const when = (ms) => formatInZone(new Date(ms), zone, { year: undefined });

    if (!sub) return ctx.reply(`Usage: ${p} 10m <text> · ${p} at 18:30 <text> · ${p} every day at 08:00 <text>\nAlso: ${p} list · ${p} del <id> · ${p} clear`);

    if (/^list$/i.test(sub)) {
      const mine = reminders.listFor(ctx.state, ctx.sender);
      if (!mine.length) return ctx.reply("You have no reminders.");
      const lines = mine.map(
        (r) => `#${r.id} · ${when(r.due)} (in ${reminders.formatDuration(r.due - Date.now())})${r.every ? ` · 🔁 every ${reminders.formatDuration(r.every)}` : ""}\n   ${r.text.slice(0, 80)}`,
      );
      return ctx.reply(`⏰ *Your reminders*\n\n${lines.join("\n")}`);
    }
    if (/^(del|delete|rm|remove|cancel|stop)$/i.test(sub)) {
      const id = Number(String(arg || "").replace("#", ""));
      if (!Number.isInteger(id)) return ctx.reply(`Usage: ${p} del <id>  (see ${p} list)`);
      return ctx.reply(reminders.remove(ctx.state, ctx.sender, id) ? `🗑️ Reminder #${id} deleted.` : `You have no reminder #${id}.`);
    }
    if (/^clear$/i.test(sub)) {
      const n = reminders.clearFor(ctx.state, ctx.sender);
      return ctx.reply(n ? `🗑️ Deleted ${n} reminder(s).` : "You have no reminders.");
    }

    const parsed = reminders.parseWhen(ctx.text, zone);
    if (!parsed) {
      return ctx.reply(`I couldn't read the time. Start with a delay (10m, 2h, 1d), a time (at 18:30, tomorrow at 9am) or a repeat (every day at 08:00).\nExample: ${p} 30m drink water`);
    }
    const item = reminders.add(ctx.state, { chat: ctx.chatId, sender: ctx.sender, text: parsed.rest, ms: parsed.ms, every: parsed.every });
    const repeat = item.every ? `, then every ${reminders.formatDuration(item.every)}` : "";
    return ctx.reply(`✅ Reminder #${item.id} set for ${when(item.due)} (in ${reminders.formatDuration(parsed.ms)})${repeat}.`);
  },
};
