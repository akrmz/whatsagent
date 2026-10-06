"use strict";

const autopost = require("../../services/autopost");
const { canManage, DENIED } = require("../../services/islamic-access");
const { UserError } = require("../../core/errors");

function status(ctx) {
  const e = autopost.get(ctx.state, ctx.chatId);
  const lines = [];
  lines.push(e?.tafsir ? `📖 آية وتفسيرها *${autopost.everyHoursAr(e.tafsir.every)}* (on)` : "📖 الآية والتفسير التلقائي: *متوقف* (off)");
  if (e?.dua) lines.push(`🤲 دعاء ${autopost.everyHoursAr(e.dua.every)}`);
  if (e) lines.push(e.quiet ? `🌙 بدون رسائل بين ${e.quiet} (${ctx.config.bot.timezone})` : "🌙 بدون ساعات هدوء");
  return lines.join("\n");
}

module.exports = {
  name: "autotafsir",
  aliases: ["dailyayah", "autoayah", "ayahtafsir"],
  category: "islamic",
  description:
    "يرسل آية عشوائية مع تفسيرها (التفسير الميسر) كل عدد من الساعات في هذه المحادثة — posts a random verse with al-Tafsir al-Muyassar here every N hours (1–24). No posts during quiet hours (default 23:00–07:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
  usage: "on [hours] | every <hours> | off | quiet <from-to|off>",
  examples: [".autotafsir on", ".autotafsir every 3", ".autotafsir quiet 22:00-06:00", ".autotafsir quiet off", ".autotafsir off"],
  cooldown: 3,
  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    const value = ctx.args.slice(1).join(" ").trim();
    const p = `${ctx.prefix}autotafsir`;
    if (!sub || sub === "status") return ctx.reply(`${status(ctx)}\n\n${p} every 3 · ${p} off · ${p} quiet 23:00-07:00`);
    if (!(await canManage(ctx))) return ctx.reply(DENIED);

    if (sub === "off") {
      autopost.stop(ctx.state, ctx.chatId, "tafsir");
      return ctx.reply("⏹️ تم إيقاف الآية والتفسير التلقائي. Auto tafsir turned off.");
    }
    if (sub === "quiet") {
      if (/^(off|none|إيقاف)$/i.test(value)) {
        autopost.setQuiet(ctx.state, ctx.chatId, null);
        return ctx.reply("✅ لا ساعات هدوء: تُرسل الرسائل في أي وقت.");
      }
      const q = autopost.parseQuiet(value);
      if (!q) throw new UserError(`اكتب الفترة مثل: ${p} quiet 23:00-07:00`);
      const text = value.replace(/\s+/g, "");
      autopost.setQuiet(ctx.state, ctx.chatId, text);
      return ctx.reply(`✅ لا رسائل تلقائية بين ${text}.`);
    }
    if (sub === "on" || sub === "every") {
      const hours = Number((value.match(/\d{1,2}/) || [])[0] || (sub === "on" ? 3 : NaN));
      if (!Number.isInteger(hours) || hours < autopost.MIN_HOURS || hours > autopost.MAX_HOURS) {
        throw new UserError(`اختر عدد ساعات من ${autopost.MIN_HOURS} إلى ${autopost.MAX_HOURS}، مثل: ${p} every 3`);
      }
      try {
        autopost.setEvery(ctx.state, ctx.chatId, "tafsir", hours);
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات. The bot already posts to the maximum number of chats.");
      }
      return ctx.reply(`✅ سأرسل آية مع تفسيرها ${autopost.everyHoursAr(hours)}، أولها خلال دقيقة.\n${status(ctx)}`);
    }
    return ctx.reply(`الاستخدام: ${p} on | every 3 | off | quiet 23:00-07:00`);
  },
};
