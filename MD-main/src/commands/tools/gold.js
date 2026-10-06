"use strict";

const gold = require("../../services/gold");
const { UserError } = require("../../core/errors");

const fmt = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
const NOTE = "_سعر عالمي تقريبي (بدون مصنعية أو فروق السوق المحلي) — global spot price, not advice._";

function currencyOf(arg) {
  const c = String(arg || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new UserError("Currency must be a 3-letter code, e.g. EGP, SAR, USD.");
  return c;
}

module.exports = [
  {
    name: "gold",
    aliases: ["dahab", "silver"],
    category: "tools",
    description: "سعر الذهب للجرام (عيار 24 و21 و18) والفضة بأي عملة — gold price per gram (24k/21k/18k) and silver, in any currency.",
    usage: "[currency]",
    examples: [".gold", ".gold egp", ".gold sar"],
    cooldown: 10,
    externalService: "gold-api.com, open.er-api.com",
    async run(ctx) {
      const currency = currencyOf(ctx.args[0]);
      const p = await gold.prices(currency);
      if (!p) return ctx.reply(`Unknown currency "${currency}".`);
      return ctx.reply(
        [
          `🪙 *سعر الذهب — ${currency}* (للجرام)`,
          "",
          `• عيار 24: *${fmt(p.gold24)}*`,
          `• عيار 21: *${fmt((p.gold24 * 21) / 24)}*`,
          `• عيار 18: *${fmt((p.gold24 * 18) / 24)}*`,
          `• الأوقية: ${fmt(p.gold24 * gold.GRAMS_PER_OUNCE)}`,
          `🥈 الفضة: ${fmt(p.silver)} للجرام`,
          "",
          NOTE,
        ].join("\n"),
      );
    },
  },
  {
    name: "zakat",
    aliases: ["zakah"],
    category: "islamic",
    description: "حاسبة زكاة المال: النصاب (85 جم ذهب / 595 جم فضة) بسعر اليوم ومقدار الزكاة 2.5% — zakat calculator for money held a full lunar year.",
    usage: "<amount> [currency]",
    examples: [".zakat 300000 egp", ".zakat 25000 sar"],
    cooldown: 10,
    externalService: "gold-api.com, open.er-api.com",
    async run(ctx) {
      const amount = Number(String(ctx.args[0] || "").replace(/[,،]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) return ctx.reply(`الاستخدام: ${ctx.prefix}zakat 300000 egp  (المبلغ الذي حال عليه الحول)`);
      const currency = currencyOf(ctx.args[1]);
      const p = await gold.prices(currency);
      if (!p) return ctx.reply(`Unknown currency "${currency}".`);
      const z = gold.zakat(amount, p);
      const lines = [
        `🕌 *زكاة المال* — ${fmt(amount)} ${currency}`,
        "",
        `📏 النصاب بالذهب (85 جم): ${fmt(z.nisabGold)} ${currency}`,
        `📏 النصاب بالفضة (595 جم): ${fmt(z.nisabSilver)} ${currency}`,
        "",
      ];
      if (z.aboveGold) lines.push(`✅ المبلغ بلغ النصاب. الزكاة الواجبة (2.5%): *${fmt(z.due)} ${currency}*`);
      else if (z.aboveSilver) lines.push(`⚖️ المبلغ بلغ نصاب الفضة ولم يبلغ نصاب الذهب. على قول من يعتبر الفضة: الزكاة *${fmt(z.due)} ${currency}*`);
      else lines.push("ℹ️ المبلغ لم يبلغ النصاب، فلا زكاة فيه.");
      lines.push("", "_تجب الزكاة إذا بلغ المال النصاب وحال عليه الحول الهجري. الأسعار عالمية تقريبية؛ للمسائل الخاصة استشر أهل العلم._");
      return ctx.reply(lines.join("\n"));
    },
  },
];
