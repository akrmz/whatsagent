"use strict";

const autoreply = require("../../services/autoreply");
const { parseQuiet } = require("../../services/autopost");
const { UserError } = require("../../core/errors");

const base = { category: "owner", permission: "owner", cooldown: 2 };

module.exports = [
  {
    ...base,
    name: "awaymsg",
    aliases: ["offhours", "outofoffice"],
    description:
      "رد تلقائي خارج مواعيد العمل — an automatic reply to private messages from others, outside your working hours (or always), at most once per person every 12 hours. Groups, you and sudo users are never answered.",
    usage: "on <message> | hours <from-to> | hours always | off | (no argument: status)",
    examples: [".awaymsg on شكراً لتواصلك 🙏 مواعيد العمل من 10 ص إلى 10 م وسنرد عليك أول ما نتاح.", ".awaymsg hours 10:00-22:00", ".awaymsg off"],
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const s = autoreply.settings(ctx.state);
      if (sub === "off") {
        autoreply.setAway(ctx.state, null);
        return ctx.reply("⏹️ Away message off.");
      }
      if (sub === "on") {
        const text = ctx.text.slice(ctx.args[0].length).trim() || s.away?.text;
        if (!text) throw new UserError(`Write the message: ${ctx.prefix}awaymsg on <message>`);
        autoreply.setAway(ctx.state, { text: text.slice(0, autoreply.MAX_TEXT) });
      } else if (sub === "hours") {
        if (!s.away) throw new UserError(`Turn it on first: ${ctx.prefix}awaymsg on <message>`);
        const v = ctx.args.slice(1).join("");
        if (/^(always|دائما|دائماً|off)$/i.test(v)) autoreply.setAway(ctx.state, { hours: null });
        else {
          if (!parseQuiet(v)) throw new UserError(`Working hours like 10:00-22:00 (the away message is sent outside them).`);
          autoreply.setAway(ctx.state, { hours: v });
        }
      } else if (sub) return ctx.reply(`Usage: ${ctx.prefix}awaymsg on <message> | hours 10:00-22:00 | off`);
      const a = autoreply.settings(ctx.state).away;
      if (!a) return ctx.reply(`🌙 Away message: *off*\n${ctx.prefix}awaymsg on <message>`);
      return ctx.reply(`🌙 Away message: *on* — ${a.hours ? `outside working hours ${a.hours}` : "always"} (once per person every 12 h)\n\n${a.text}`);
    },
  },
  {
    ...base,
    name: "greet",
    aliases: ["welcomepm", "firstmsg"],
    description:
      "رسالة ترحيب لأول تواصل — a welcome sent the first time someone ever writes to you privately (e.g. who you are and how to ask about a listing). Who was greeted is kept as fingerprints, not phone numbers.",
    usage: "on <message> | off | (no argument: status)",
    examples: [".greet on أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله، أو اكتب طلبك وسنرد عليك.", ".greet off"],
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      if (sub === "off") {
        autoreply.setGreet(ctx.state, null);
        return ctx.reply("⏹️ Welcome message off.");
      }
      if (sub === "on") {
        const text = ctx.text.slice(ctx.args[0].length).trim();
        if (!text) throw new UserError(`Write the message: ${ctx.prefix}greet on <message>`);
        autoreply.setGreet(ctx.state, text);
      } else if (sub) return ctx.reply(`Usage: ${ctx.prefix}greet on <message> | off`);
      const g = autoreply.settings(ctx.state).greet;
      return ctx.reply(g ? `👋 Welcome message: *on* (first message from each person; people who wrote before are not greeted)\n\n${g.text}` : `👋 Welcome message: *off*\n${ctx.prefix}greet on <message>`);
    },
  },
];
