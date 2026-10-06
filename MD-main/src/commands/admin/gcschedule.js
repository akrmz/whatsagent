"use strict";

const schedule = require("../../services/gcschedule");

module.exports = {
  name: "gcschedule",
  aliases: ["autoclose", "groupschedule"],
  category: "admin",
  description: "Closes the group every day at one time (only admins can write) and opens it at another. Times use the bot's TIMEZONE.",
  usage: "close <time> | open <time> | off | (no argument: show)",
  examples: [".gcschedule close 23:00", ".gcschedule open 08:00", ".gcschedule off"],
  permission: "groupAdmin",
  botAdmin: true,
  cooldown: 3,

  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    const time = ctx.args.slice(1).join(" ").toLowerCase(); // "23:00", "11pm" or "11 pm"
    const p = `${ctx.prefix}gcschedule`;
    const show = () => {
      const e = schedule.get(ctx.state, ctx.chatId);
      if (!e || (!e.close && !e.open)) return `No schedule. Example: ${p} close 23:00 and ${p} open 08:00`;
      return `🕒 Daily schedule (${ctx.config.bot.timezone}):\n🔒 close at ${e.close || "—"}\n🔓 open at ${e.open || "—"}\n\nTurn off: ${p} off`;
    };
    if (!sub) return ctx.reply(show());
    if (sub === "off") {
      const which = time === "close" || time === "open" ? time : null;
      schedule.clear(ctx.state, ctx.chatId, which);
      return ctx.reply(which ? `✅ The daily ${which} time was removed.` : "✅ The daily schedule was removed.");
    }
    if (sub !== "close" && sub !== "open") return ctx.reply(`Usage: ${p} close 23:00 · ${p} open 08:00 · ${p} off`);
    const saved = schedule.set(ctx.state, ctx.chatId, sub, time || "", ctx.config.bot.timezone);
    if (!saved) return ctx.reply(`Give a time like 23:00 or 11pm, e.g. ${p} ${sub} ${sub === "close" ? "23:00" : "08:00"}`);
    return ctx.reply(`✅ The group will ${sub} every day at ${saved}.\n\n${show()}`);
  },
};
