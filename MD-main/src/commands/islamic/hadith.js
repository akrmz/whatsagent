"use strict";

const hadith = require("../../services/hadith");
const autopost = require("../../services/autopost");
const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { UserError } = require("../../core/errors");

module.exports = [
  {
    name: "hadith",
    aliases: ["hadeeth", "hadis"],
    category: "islamic",
    description: "حديث نبوي عشوائي مع درجته ومصدره وشرح مختصر، من موسوعة الأحاديث النبوية — a random hadith with its grade, source and a short explanation (hadeethenc.com).",
    usage: "[رقم الحديث]",
    examples: [".hadith", ".hadith 2962"],
    cooldown: 10,
    externalService: "hadeethenc.com",
    async run(ctx) {
      const id = ctx.args[0];
      const h = id ? await hadith.byId(id) : await hadith.randomHadith();
      if (!h) return ctx.reply("لم أجد هذا الحديث. اكتب .hadith لحديث عشوائي.");
      return ctx.reply(hadith.format(h));
    },
  },
  {
    name: "autohadith",
    aliases: ["dailyhadith"],
    category: "islamic",
    description:
      "يرسل حديثاً عشوائياً مع شرحه كل عدد من الساعات (1–24) في هذه المحادثة، أولها فوراً — posts a random hadith here every N hours, the first right away. Quiet hours as for .autotafsir.",
    usage: "every <hours> | on | off",
    examples: [".autohadith every 6", ".autohadith on", ".autohadith off"],
    cooldown: 5,
    externalService: "hadeethenc.com",
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const zone = ctx.config.bot.timezone;
      const status = () => {
        const e = autopost.get(ctx.state, ctx.chatId);
        if (!e?.hadith) return `📜 الحديث التلقائي: *متوقف* (off)\n${zoneLine(ctx)}`;
        const next = autopost.describeNext(autopost.effectiveNext(e.hadith, e.quiet, zone), zone);
        return `📜 حديث ${autopost.everyHoursAr(e.hadith.every)} (on)\n⏭️ التالي: ${next}\n${e.quiet ? `🌙 بدون رسائل تلقائية بين ${e.quiet}` : "🌙 بدون ساعات هدوء"}\n${zoneLine(ctx)}`;
      };
      if (!sub) return ctx.reply(status());
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      if (sub === "off") {
        autopost.stop(ctx.state, ctx.chatId, "hadith");
        return ctx.reply("⏹️ تم إيقاف الحديث التلقائي.");
      }
      if (sub !== "on" && sub !== "every") return ctx.reply(`الاستخدام: ${ctx.prefix}autohadith every 6 | off`);
      const hours = Number((ctx.args[1] || "").match(/^\d{1,2}$/)?.[0] || (sub === "on" ? 6 : NaN));
      if (!Number.isInteger(hours) || hours < autopost.MIN_HOURS || hours > autopost.MAX_HOURS) {
        throw new UserError(`اختر عدد ساعات من ${autopost.MIN_HOURS} إلى ${autopost.MAX_HOURS}، مثل: ${ctx.prefix}autohadith every 6`);
      }
      let first = null;
      try {
        first = hadith.format(await hadith.randomHadith());
      } catch (err) {
        ctx.log.warn({ err: err.message }, "first hadith failed; the loop will retry");
      }
      try {
        autopost.setEvery(ctx.state, ctx.chatId, "hadith", hours, Date.now(), { sentNow: Boolean(first) });
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات. The bot already posts to the maximum number of chats.");
      }
      if (first) await ctx.send(first);
      return ctx.reply(`✅ ${status()}`);
    },
  },
];
