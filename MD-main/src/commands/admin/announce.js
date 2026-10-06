"use strict";

const reminders = require("../../services/reminders");
const { formatInZone } = require("../../services/geo");

module.exports = {
  name: "announce",
  aliases: ["schedulemsg", "announcement"],
  category: "admin",
  description: "Schedules a message to this group — once or repeating — sent as plain text without mentioning anyone. Times use the bot's TIMEZONE.",
  usage: "<when> <text> | list | del <id>",
  examples: [".announce every day at 08:00 Good morning everyone ☀️", ".announce every friday at 20:00 Weekly meeting in 1 hour", ".announce at 21:00 Live stream starts now!", ".announce list"],
  permission: "groupAdmin",
  cooldown: 3,

  async run(ctx) {
    const [sub, arg] = ctx.args;
    const p = `${ctx.prefix}announce`;
    const zone = ctx.config.bot.timezone;
    const when = (ms) => formatInZone(new Date(ms), zone, { year: undefined });
    if (!sub) return ctx.reply(`Usage: ${p} every day at 08:00 <text> · ${p} at 21:00 <text> · ${p} list · ${p} del <id>`);

    if (/^list$/i.test(sub)) {
      const items = reminders.announcementsIn(ctx.state, ctx.chatId);
      if (!items.length) return ctx.reply("No announcements are scheduled in this group.");
      const lines = items.map((r) => `#${r.id} · ${when(r.due)}${r.every ? ` · 🔁 every ${reminders.formatDuration(r.every)}` : ""}\n   ${r.text.slice(0, 80)}`);
      return ctx.reply(`📢 *Scheduled announcements*\n\n${lines.join("\n")}`);
    }
    if (/^(del|delete|rm|remove|cancel|stop)$/i.test(sub)) {
      const id = Number(String(arg || "").replace("#", ""));
      if (!Number.isInteger(id)) return ctx.reply(`Usage: ${p} del <id>  (see ${p} list)`);
      return ctx.reply(reminders.removeAnnouncement(ctx.state, ctx.chatId, id) ? `🗑️ Announcement #${id} deleted.` : `There is no announcement #${id} in this group.`);
    }

    const parsed = reminders.parseWhen(ctx.text, zone);
    if (!parsed) return ctx.reply(`I couldn't read the time. Examples:\n${p} every day at 08:00 Good morning\n${p} at 21:00 Meeting now\n${p} 2h Break is over`);
    const item = reminders.add(ctx.state, { chat: ctx.chatId, sender: ctx.sender, text: parsed.rest, ms: parsed.ms, every: parsed.every, announce: true });
    return ctx.reply(`✅ Announcement #${item.id} scheduled for ${when(item.due)}${item.every ? `, then every ${reminders.formatDuration(item.every)}` : ""}.`);
  },
};
