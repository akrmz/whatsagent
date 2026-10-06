"use strict";

const hamla = require("../../services/hamla");
const { canManage, DENIED } = require("../../services/islamic-access");
const { at } = require("../../services/targets");
const { UserError } = require("../../core/errors");

function showBoard(ctx, prefix = "") {
  const h = hamla.get(ctx.state, ctx.chatId);
  if (!h) return ctx.reply(`📿 لا توجد حملة ذكر في هذه المجموعة.\nابدأ واحدة: ${ctx.prefix}hamla new 10000 استغفار`);
  const b = hamla.board(h, at);
  const help = h.finishedAt ? `\n\n${ctx.prefix}hamla new لبدء حملة جديدة` : `\n\nأضف ما قرأت: أرسل *+100* أو ${ctx.prefix}hamla 100`;
  return ctx.reply({ text: `${prefix}${b.text}${help}`, mentions: b.mentions });
}

module.exports = {
  name: "hamla",
  aliases: ["campaign", "dhikrgoal", "athkargoal"],
  category: "islamic",
  description:
    "حملة ذكر جماعية بهدف مشترك (مثل ١٠٬٠٠٠ استغفار): يضيف كل عضو ما قرأ بإرسال +100 — a group dhikr campaign with a shared goal; members add their count by sending \"+100\" (or .hamla 100). Presets: استغفار، صلاة، تسبيح، تهليل، تكبير، حوقلة, or any text. Starting or ending one follows ISLAMIC_ADMIN_ONLY like .autoazkar.",
  usage: "new <goal> [dhikr] | <count> | undo | end | (no argument: progress)",
  examples: [".hamla new 10000 استغفار", ".hamla new 1000 صلاة", "+100", ".hamla 33", ".hamla undo"],
  groupOnly: true,
  cooldown: 2,
  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    if (!sub || sub === "status") return showBoard(ctx);
    if (sub === "undo") {
      const n = hamla.undo(ctx.state, ctx.chatId, ctx.sender);
      return ctx.reply(`↩️ أُزيلت آخر إضافة لك (${hamla.fmt(n)}).`);
    }
    if (/^[\d٠-٩]/.test(sub)) {
      const r = hamla.add(ctx.state, ctx.chatId, ctx.sender, hamla.toNumber(sub));
      if (r.finished) return showBoard(ctx, "🎉 *الحمد لله، اكتمل الهدف!*\n\n");
      return ctx.reply(`📿 +${hamla.fmt(r.added)} · المجموع ${hamla.fmt(r.total)} من ${hamla.fmt(r.goal)}`);
    }
    if (!(await canManage(ctx))) return ctx.reply(DENIED);
    if (sub === "end" || sub === "off") {
      if (!hamla.get(ctx.state, ctx.chatId)) return ctx.reply("لا توجد حملة لإنهائها.");
      hamla.remove(ctx.state, ctx.chatId);
      return ctx.reply("⏹️ أُنهيت حملة الذكر.");
    }
    if (sub === "new" || sub === "start") {
      const goal = hamla.toNumber(ctx.args[1] || "");
      if (!ctx.args[1] || !Number.isInteger(goal)) throw new UserError(`الاستخدام: ${ctx.prefix}hamla new 10000 استغفار`);
      const cur = hamla.active(ctx.state, ctx.chatId);
      const rest = ctx.args.slice(2);
      const confirmed = rest.at(-1)?.toLowerCase() === "confirm";
      if (cur && cur.total > 0 && !confirmed) {
        return ctx.reply(`⚠️ حملة "${cur.dhikr}" ما زالت جارية (${hamla.fmt(cur.total)} من ${hamla.fmt(cur.goal)}). لاستبدالها أضف confirm في آخر الأمر.`);
      }
      hamla.start(ctx.state, ctx.chatId, { goal, dhikr: (confirmed ? rest.slice(0, -1) : rest).join(" ") });
      return showBoard(ctx, "🆕 بدأت حملة جديدة!\n\n");
    }
    return ctx.reply(`الاستخدام: ${ctx.prefix}hamla new 10000 استغفار | ${ctx.prefix}hamla 100 | +100 | ${ctx.prefix}hamla undo | ${ctx.prefix}hamla end`);
  },
};
