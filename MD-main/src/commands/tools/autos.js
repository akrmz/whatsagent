"use strict";

const azkar = require("../../services/azkar");
const adhan = require("../../services/adhan");
const autopost = require("../../services/autopost");
const wird = require("../../services/wird");
const schedule = require("../../services/gcschedule");
const reminders = require("../../services/reminders");
const captcha = require("../../services/captcha");
const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { stopAll } = require("../../services/automations");
const jumuah = require("../../services/jumuah");
const khatma = require("../../services/khatma");

/** Every automatic thing that runs in this chat, in one list. */
function overview(ctx) {
  const { state, chatId: chat, prefix: p } = ctx;
  const lines = [];
  const az = azkar.getAuto(state, chat);
  if (az) lines.push(`📿 أذكار الصباح والمساء${az.city ? ` (${az.city})` : ` ${az.morning || azkar.DEFAULTS.morning} / ${az.evening || azkar.DEFAULTS.evening}`}${az.dua ? ` + دعاء ${az.dua}` : ""} — ${p}autoazkar`);
  const pr = adhan.get(state, chat);
  if (pr) lines.push(`🕌 تنبيهات الصلاة — ${pr.city} — ${p}autoprayer`);
  const post = autopost.get(state, chat);
  if (post?.tafsir) lines.push(`📖 آية وتفسير ${autopost.everyHoursAr(post.tafsir.every)} — ${p}autotafsir`);
  if (post?.dua) lines.push(`🤲 دعاء ${autopost.everyHoursAr(post.dua.every)} — ${p}autoazkar dua`);
  if (post?.hadith) lines.push(`📜 حديث ${autopost.everyHoursAr(post.hadith.every)} — ${p}autohadith`);
  if (post && (post.tafsir || post.dua || post.hadith)) lines.push(`   🌙 ساعات الهدوء: ${post.quiet || "بدون"}`);
  const w = wird.get(state, chat);
  if (w) lines.push(`📖 الورد اليومي: ${wird.pagesAr(w.pages)} الساعة ${w.time || wird.DEFAULT_TIME} (صفحة ${w.next}) — ${p}autowird`);
  const j = jumuah.get(state, chat);
  if (j) lines.push(`🕌 تذكير الجمعة الساعة ${j.time} — ${p}autojumuah`);
  const k = khatma.get(state, chat);
  if (k) lines.push(`📖 ختمة جماعية: ${khatma.ar(khatma.counts(k).read)}/${khatma.ar(khatma.PARTS)} جزءاً — ${p}khatma`);
  const g = schedule.get(state, chat);
  if (g && (g.close || g.open)) lines.push(`🔒 إغلاق/فتح المجموعة: ${g.close || "—"} / ${g.open || "—"} — ${p}gcschedule`);
  const ann = reminders.announcementsIn(state, chat);
  if (ann.length) lines.push(`📢 ${ann.length} إعلان مجدول — ${p}announce list`);
  const c = captcha.get(state, chat);
  if (c?.enabled) lines.push(`🤖 التحقق من الأعضاء الجدد (captcha) — ${p}captcha`);
  return lines;
}

module.exports = {
  name: "autos",
  aliases: ["automations", "scheduled", "auto"],
  category: "tools",
  description: "كل ما يعمل تلقائياً في هذه المحادثة في قائمة واحدة، و\".autos off\" لإيقاف الرسائل الإسلامية التلقائية كلها — lists everything automatic in this chat; \".autos off\" stops all automatic Islamic posts here.",
  usage: "[off]",
  examples: [".autos", ".autos off"],
  cooldown: 5,
  async run(ctx) {
    if ((ctx.args[0] || "").toLowerCase() === "off") {
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      stopAll(ctx.state, ctx.chatId);
      const rest = overview(ctx);
      return ctx.reply(`⏹️ أُوقفت الأذكار والتنبيهات والآيات والأحاديث والورد وتذكير الجمعة هنا.${rest.length ? `\n\nما زال يعمل (يديره المشرفون):\n${rest.join("\n")}` : ""}`);
    }
    const lines = overview(ctx);
    if (!lines.length) return ctx.reply(`لا يوجد شيء تلقائي في هذه المحادثة.\nأمثلة: ${ctx.prefix}autoazkar on · ${ctx.prefix}autotafsir every 3 · ${ctx.prefix}autowird on 2 20:00`);
    return ctx.reply(`⚙️ *التلقائي في هذه المحادثة*\n\n${lines.join("\n")}\n\n${zoneLine(ctx)}\n\n${ctx.prefix}autos off لإيقاف الرسائل الإسلامية التلقائية كلها`);
  },
};
