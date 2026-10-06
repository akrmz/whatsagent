"use strict";

const khatma = require("../../services/khatma");
const jumuah = require("../../services/jumuah");
const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { parseClock } = require("../../services/reminders");
const { at } = require("../../services/targets");
const { UserError } = require("../../core/errors");

const partArg = (a) => {
  if (a === undefined) return undefined;
  const n = Number(String(a).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!Number.isInteger(n)) throw new UserError("اكتب رقم الجزء، مثل: .khatma take 5");
  return n;
};

function showBoard(ctx, prefix = "") {
  const k = khatma.get(ctx.state, ctx.chatId);
  if (!k) return ctx.reply(`📖 لا توجد ختمة جماعية في هذه المجموعة.\nابدأ واحدة: ${ctx.prefix}khatma new`);
  const b = khatma.board(k, at);
  const help = `\n\n${ctx.prefix}khatma take [رقم] لحجز جزء · ${ctx.prefix}khatma done عند الانتهاء`;
  return ctx.reply({ text: `${prefix}${b.text}${khatma.counts(k).free || khatma.counts(k).taken ? help : `\n\n${ctx.prefix}khatma new لبدء ختمة جديدة`}`, mentions: b.mentions });
}

module.exports = [
  {
    name: "khatma",
    aliases: ["khatmah", "groupkhatma"],
    category: "islamic",
    description:
      "ختمة جماعية: يحجز كل عضو جزءاً من الثلاثين ويقرؤه ثم يعلن انتهاءه حتى تكتمل الختمة — a shared group khatma: members take one of the 30 juz', read it and mark it done. Starting or ending one follows the same rule as .autoazkar (anyone, unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "new | take [juz] | done [juz] | drop <juz> | info <juz> | remind | end | (no argument: the board)",
    examples: [".khatma new", ".khatma take", ".khatma take 5", ".khatma done", ".khatma info 5"],
    groupOnly: true,
    cooldown: 3,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const n = partArg(ctx.args[1]);
      if (!sub || sub === "status" || sub === "board") return showBoard(ctx);

      if (sub === "info") {
        if (n === undefined || n < 1 || n > khatma.PARTS) throw new UserError(`اكتب رقم الجزء من 1 إلى ${khatma.PARTS}.`);
        const j = khatma.juzInfo(n);
        return ctx.reply(`📖 ${khatma.partLine(n)}\n\nلقراءته صفحة صفحة: ${ctx.prefix}wird page ${j.pages[0]}`);
      }
      if (sub === "take" || sub === "join") {
        const got = khatma.take(ctx.state, ctx.chatId, ctx.sender, n);
        const j = khatma.juzInfo(got);
        return ctx.reply({
          text: `✅ ${at(ctx.sender)} حجزت *${khatma.partLine(got)}*\nأوله: ${ctx.prefix}wird page ${j.pages[0]}\nعند الانتهاء اكتب: ${ctx.prefix}khatma done ${got}`,
          mentions: [ctx.sender],
        });
      }
      if (sub === "done" || sub === "read") {
        const manager = n !== undefined && (await canManage(ctx));
        const r = khatma.done(ctx.state, ctx.chatId, ctx.sender, n, { manager });
        if (r.finished) return showBoard(ctx, "🎉 *الحمد لله، تمّت الختمة!* تقبّل الله منّا ومنكم.\n\n");
        const { read } = khatma.counts(khatma.get(ctx.state, ctx.chatId));
        return ctx.reply(`✅ بارك الله فيك، الجزء ${khatma.ar(r.n)} مقروء. (${khatma.ar(read)}/${khatma.ar(khatma.PARTS)})`);
      }
      if (sub === "drop" || sub === "leave") {
        if (n === undefined) throw new UserError(`اكتب رقم الجزء: ${ctx.prefix}khatma drop 5`);
        const manager = await canManage(ctx);
        khatma.drop(ctx.state, ctx.chatId, ctx.sender, n, { manager });
        return ctx.reply(`↩️ الجزء ${khatma.ar(n)} متاح الآن لغيرك.`);
      }
      if (sub === "remind" || sub === "nudge") {
        if (!(await canManage(ctx))) return ctx.reply(DENIED);
        const k = khatma.get(ctx.state, ctx.chatId);
        if (!k) return ctx.reply(`لا توجد ختمة. ابدأ واحدة بـ ${ctx.prefix}khatma new`);
        const open = khatma.openParts(k);
        if (!open.length) return ctx.reply("لا توجد أجزاء محجوزة لم تُقرأ بعد. 👍");
        khatma.markReminded(ctx.state, ctx.chatId);
        const days = (t) => Math.floor((Date.now() - t) / 86400000);
        const lines = open.map((o) => `• ${at(o.user)} — الجزء ${o.parts.map(khatma.ar).join("، ")}${days(o.since) >= 1 ? ` (منذ ${khatma.ar(days(o.since))} يوم)` : ""}`);
        return ctx.reply({
          text: `⏰ *تذكير بالختمة الجماعية*\n\n${lines.join("\n")}\n\nعند الانتهاء: ${ctx.prefix}khatma done · لإرجاع جزء: ${ctx.prefix}khatma drop <رقم>`,
          mentions: open.map((o) => o.user),
        });
      }
      if (sub === "new" || sub === "start" || sub === "end" || sub === "off") {
        if (!(await canManage(ctx))) return ctx.reply(DENIED);
        const k = khatma.get(ctx.state, ctx.chatId);
        if (sub === "end" || sub === "off") {
          if (!k) return ctx.reply("لا توجد ختمة لإنهائها.");
          khatma.remove(ctx.state, ctx.chatId);
          return ctx.reply("⏹️ أُنهيت الختمة الجماعية في هذه المجموعة.");
        }
        const { read, taken } = k ? khatma.counts(k) : { read: 0, taken: 0 };
        const unfinished = k && read < khatma.PARTS && read + taken > 0;
        if (unfinished && (ctx.args[1] || "").toLowerCase() !== "confirm") {
          return ctx.reply(`⚠️ الختمة الحالية لم تكتمل (${khatma.ar(read)}/${khatma.ar(khatma.PARTS)}). لبدء ختمة جديدة مكانها اكتب: ${ctx.prefix}khatma new confirm`);
        }
        khatma.start(ctx.state, ctx.chatId);
        return showBoard(ctx, "🆕 بدأت ختمة جديدة! احجز جزءك.\n\n");
      }
      return ctx.reply(`الاستخدام: ${ctx.prefix}khatma | new | take [رقم] | done [رقم] | drop <رقم> | info <رقم> | remind | end`);
    },
  },
  {
    name: "autojumuah",
    aliases: ["jumuah", "friday", "autofriday"],
    category: "islamic",
    description:
      "تذكير يوم الجمعة: آية الجمعة، وسورة الكهف، والصلاة على النبي ﷺ، وساعة الإجابة، كل جمعة في الوقت الذي تختاره — a Friday reminder every week at the time you choose (default 09:00). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "on [time] | off | now | (no argument: status)",
    examples: [".autojumuah on", ".autojumuah on 10:30", ".autojumuah now", ".autojumuah off"],
    cooldown: 5,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const e = jumuah.get(ctx.state, ctx.chatId);
      if (!sub || sub === "status") {
        if (!e) return ctx.reply(`🕌 تذكير الجمعة: *متوقف* (off)\nللتشغيل: ${ctx.prefix}autojumuah on 09:00`);
        const next = jumuah.nextSend(e, ctx.config.bot.timezone);
        return ctx.reply(`🕌 *تذكير الجمعة* (on): كل جمعة الساعة ${e.time}\n⏭️ القادم: ${next.day} ${next.time}\n${zoneLine(ctx)}`);
      }
      if (sub === "now" || sub === "test") return ctx.reply(jumuah.message(ctx.prefix));
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      if (sub === "off") {
        jumuah.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ تم إيقاف تذكير الجمعة.");
      }
      if (sub !== "on") return ctx.reply(`الاستخدام: ${ctx.prefix}autojumuah on 09:00 | off | now`);
      const timeArg = ctx.args.slice(1).join(" ");
      const minutes = parseClock(timeArg || jumuah.DEFAULT_TIME);
      if (minutes === null) throw new UserError(`اكتب الوقت مثل 09:00 أو 10am. مثال: ${ctx.prefix}autojumuah on 09:00`);
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      try {
        jumuah.set(ctx.state, ctx.chatId, { time });
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات.");
      }
      const next = jumuah.nextSend(jumuah.get(ctx.state, ctx.chatId), ctx.config.bot.timezone);
      return ctx.reply(`✅ تذكير الجمعة كل جمعة الساعة ${time}.\n⏭️ القادم: ${next.day} ${next.time}\n${zoneLine(ctx)}\n\n${ctx.prefix}autojumuah now لرؤية الرسالة.`);
    },
  },
];
