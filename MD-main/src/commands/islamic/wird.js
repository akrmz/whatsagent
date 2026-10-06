"use strict";

const wird = require("../../services/wird");
const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

function status(ctx) {
  const e = wird.get(ctx.state, ctx.chatId);
  if (!e) return `📖 الورد اليومي: *متوقف* (off)\nللتشغيل: ${ctx.prefix}autowird on 2 20:00  (صفحتان يومياً الساعة 8 مساءً)`;
  const left = wird.TOTAL_PAGES - e.next + 1;
  return [
    `📖 *الورد اليومي* (on): ${wird.pagesAr(e.pages)} يومياً الساعة ${e.time || wird.DEFAULT_TIME}`,
    `📍 الموضع: صفحة ${e.next} من ${wird.TOTAL_PAGES} · بقي ${wird.pagesAr(left)} (~${Math.ceil(left / e.pages)} يوماً للختم)`,
    e.khatmas ? `🏆 الختمات: ${e.khatmas}` : null,
    zoneLine(ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = [
  {
    name: "autowird",
    aliases: ["dailywird"],
    category: "islamic",
    description:
      "الورد اليومي: يرسل كل يوم عدداً من صفحات المصحف بالترتيب حتى الختم ثم يبدأ ختمة جديدة — sends N mushaf pages a day in order until the Quran is completed, then starts again. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "on [pages 1-20] [time] | off | page <n> | (no argument: status)",
    examples: [".autowird on 2 20:00", ".autowird on 4", ".autowird page 100", ".autowird off"],
    cooldown: 5,
    externalService: "alquran.cloud",
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      if (!sub || sub === "status") return ctx.reply(status(ctx));
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      if (sub === "off") {
        wird.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ تم إيقاف الورد اليومي (الموضع لم يُحفظ).");
      }
      if (sub === "page") {
        const page = Number(ctx.args[1]);
        if (!wird.get(ctx.state, ctx.chatId)) return ctx.reply(`شغّل الورد أولاً: ${ctx.prefix}autowird on`);
        if (!Number.isInteger(page) || page < 1 || page > wird.TOTAL_PAGES) throw new UserError(`اكتب رقم صفحة من 1 إلى ${wird.TOTAL_PAGES}.`);
        wird.setPosition(ctx.state, ctx.chatId, page);
        return ctx.reply(`✅ ${status(ctx)}`);
      }
      if (sub !== "on") return ctx.reply(`الاستخدام: ${ctx.prefix}autowird on 2 20:00 | off | page 100`);
      const rest = ctx.args.slice(1);
      const pagesArg = rest.find((a) => /^\d{1,2}$/.test(a));
      const timeArg = rest.filter((a) => a !== pagesArg).join(" ");
      const pages = pagesArg ? Number(pagesArg) : 2;
      if (pages < 1 || pages > wird.MAX_PAGES) throw new UserError(`عدد الصفحات من 1 إلى ${wird.MAX_PAGES}.`);
      const minutes = timeArg ? parseClock(timeArg) : parseClock(wird.DEFAULT_TIME);
      if (minutes === null) throw new UserError(`اكتب الوقت مثل 20:00 أو 9pm. مثال: ${ctx.prefix}autowird on 2 20:00`);
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      try {
        wird.set(ctx.state, ctx.chatId, { pages, time });
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات.");
      }
      wird.skipIfPassed(ctx.state, ctx.chatId, ctx.config.bot.timezone);
      return ctx.reply(`✅ ${status(ctx)}\n\n${ctx.prefix}wird لقراءة ورد اليوم الآن.`);
    },
  },
  {
    name: "wird",
    aliases: ["werd"],
    category: "islamic",
    description: "يرسل الورد التالي الآن (ويتقدّم الموضع)، أو صفحة محددة من المصحف — sends the next portion of this chat's daily wird now, or any mushaf page.",
    usage: "[page <n>]",
    examples: [".wird", ".wird page 1"],
    cooldown: 15,
    externalService: "alquran.cloud",
    async run(ctx) {
      if ((ctx.args[0] || "").toLowerCase() === "page") {
        const page = Number(ctx.args[1]);
        if (!Number.isInteger(page) || page < 1 || page > wird.TOTAL_PAGES) throw new UserError(`اكتب رقم صفحة من 1 إلى ${wird.TOTAL_PAGES}.`);
        return ctx.reply(wird.formatPortion(await wird.portion(page, 1), { view: true }));
      }
      if (!wird.get(ctx.state, ctx.chatId)) {
        return ctx.reply(`لا يوجد ورد يومي هنا بعد. للتشغيل: ${ctx.prefix}autowird on 2 20:00\nلصفحة معينة: ${ctx.prefix}wird page 1`);
      }
      return ctx.reply(await wird.takePortion(ctx.state, ctx.chatId));
    },
  },
];
