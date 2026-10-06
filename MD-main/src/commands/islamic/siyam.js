"use strict";

const siyam = require("../../services/siyam");
const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

function status(ctx) {
  const e = siyam.get(ctx.state, ctx.chatId);
  if (!e) return `🌙 تذكير صيام السنة: *متوقف* (off)\nللتشغيل: ${ctx.prefix}autosiyam on 20:00`;
  return [
    `🌙 *تذكير صيام السنة* (on): مساء اليوم السابق الساعة ${e.time}`,
    `الاثنين والخميس: ${e.weekly === false ? "لا" : "نعم"} · الأيام البيض وعرفة وعاشوراء والست من شوال: نعم`,
    zoneLine(ctx),
  ].join("\n");
}

module.exports = [
  {
    name: "siyam",
    aliases: ["sawm", "fasting", "siam"],
    category: "islamic",
    description:
      "أيام صيام السنة القادمة: الاثنين والخميس، والأيام البيض، وعرفة، وتاسوعاء وعاشوراء، والست من شوال — the coming sunnah fasting days (next 30 days), by the Umm al-Qura calendar, with the next Arafah and Ashura.",
    usage: "[days 7-60]",
    examples: [".siyam", ".siyam 60"],
    cooldown: 5,
    async run(ctx) {
      const days = ctx.args[0] ? Number(ctx.args[0]) : 30;
      if (!Number.isInteger(days) || days < 7 || days > 60) throw new UserError(`الاستخدام: ${ctx.prefix}siyam [7-60]`);
      const zone = ctx.config.bot.timezone;
      const now = Date.now();
      const list = siyam.upcoming(now, zone, { days });
      const lines = list.map((f) => `• ${f.inDays === 1 ? "*غداً*" : f.day} ${f.weekday} ${siyam.ar(f.hijri.day)} ${f.hijri.monthName}: ${f.reasons.join("، ")}`);
      const special = siyam
        .upcoming(now, zone, { days: 400, weekly: false })
        .filter((f) => f.reasons.some((r) => /يوم عرفة|يوم عاشوراء/.test(r)))
        .slice(0, 2)
        .map((f) => `• ${f.reasons.find((r) => /يوم عرفة|يوم عاشوراء/.test(r))}: ${f.day} (بعد ${siyam.ar(f.inDays)} يوماً)`);
      return ctx.reply(
        [
          `🌙 *أيام صيام السنة في الأيام الـ${siyam.ar(days)} القادمة*`,
          "",
          ...(lines.length ? lines : ["لا شيء."]),
          special.length ? `\n${special.join("\n")}` : "",
          "",
          "_تقويم أم القرى — قد يختلف يوماً حسب رؤية الهلال في بلدك._",
          `${ctx.prefix}autosiyam on لتذكير المجموعة مساء اليوم السابق.`,
        ].join("\n"),
      );
    },
  },
  {
    name: "autosiyam",
    aliases: ["autosawm", "autofasting", "fastreminder"],
    category: "islamic",
    description:
      "تذكير مساء اليوم السابق بصيام السنة: الاثنين والخميس، والأيام البيض، وعرفة، وتاسوعاء وعاشوراء، والست من شوال — reminds this chat the evening before each sunnah fast (default 20:00). \"weekly off\" keeps only the white days and the special days. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "on [time] | weekly on|off | off | now | (no argument: status)",
    examples: [".autosiyam on", ".autosiyam on 21:30", ".autosiyam weekly off", ".autosiyam off"],
    cooldown: 5,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      if (!sub || sub === "status") return ctx.reply(status(ctx));
      if (sub === "now" || sub === "test") {
        const e = siyam.get(ctx.state, ctx.chatId);
        return ctx.reply(siyam.reminderFor(Date.now(), ctx.config.bot.timezone, { weekly: e?.weekly !== false }) || "غداً ليس من أيام صيام السنة المعتادة. اكتب .siyam لرؤية الأيام القادمة.");
      }
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      if (sub === "off") {
        siyam.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ تم إيقاف تذكير صيام السنة.");
      }
      if (sub === "weekly") {
        const v = (ctx.args[1] || "").toLowerCase();
        if (!["on", "off"].includes(v)) throw new UserError(`الاستخدام: ${ctx.prefix}autosiyam weekly on|off`);
        if (!siyam.get(ctx.state, ctx.chatId)) return ctx.reply(`شغّل التذكير أولاً: ${ctx.prefix}autosiyam on`);
        siyam.set(ctx.state, ctx.chatId, { weekly: v === "on" });
        return ctx.reply(`✅ ${status(ctx)}`);
      }
      if (sub !== "on") return ctx.reply(`الاستخدام: ${ctx.prefix}autosiyam on 20:00 | weekly off | off | now`);
      const minutes = parseClock(ctx.args.slice(1).join(" ") || siyam.DEFAULT_TIME);
      if (minutes === null) throw new UserError(`اكتب الوقت مثل 20:00 أو 9pm. مثال: ${ctx.prefix}autosiyam on 20:00`);
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      try {
        siyam.set(ctx.state, ctx.chatId, { time });
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات.");
      }
      return ctx.reply(`✅ ${status(ctx)}\n\n${ctx.prefix}siyam لرؤية الأيام القادمة.`);
    },
  },
];
