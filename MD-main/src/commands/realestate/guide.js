"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const autolistings = require("../../services/autolistings");
const digest = require("../../services/digest");
const autoreply = require("../../services/autoreply");

const done = (ok) => (ok ? "✅" : "⬜");

module.exports = {
  name: "rehelp",
  aliases: ["dalil", "reguide", "aqarguide"],
  category: "realestate",
  description: "دليل أدوات العقارات بالعربي — a short Arabic guide to the real-estate tools, step by step, showing which steps you have already done.",
  permission: "sudo",
  cooldown: 5,
  async run(ctx) {
    const p = ctx.prefix;
    const a = re.agent(ctx.state);
    const listings = re.all(ctx.state);
    const clients = leads.all(ctx.state);
    const ar = autoreply.settings(ctx.state);
    const steps = [
      [Boolean(a.name && a.phone), `*١. بياناتك*\n${p}agent name اسمك\n${p}agent phone رقمك\n${p}agent company اسم الشركة`],
      [listings.length > 0, `*٢. أضف عقاراً* — انسخ الإعلان كما هو أو اكتب التفاصيل:\n${p}listing add شقة للبيع في التجمع 150 متر 3 غرف بسعر 3.5 مليون\nثم الصور: رد على الصورة بـ ${p}listing photo <الرقم>`],
      [clients.length > 0, `*٣. عملاؤك*\n${p}lead add أحمد 0100… عايز شقة في التجمع ميزانية من 2 ل 3 مليون\nأو أرسل للبوت جهة اتصال العميل ورد عليها بـ ${p}lead add`],
      [Boolean(a.autoleads), `*٤. استقبال الاستفسارات تلقائياً*\n${p}agent autoleads on — من يسأل عن #رقم يُحفظ كعميل وتصلك رسالة`],
      [Boolean(ar.away || ar.greet), `*٥. الرد التلقائي*\n${p}greet on رسالة ترحيب لأول تواصل\n${p}awaymsg on رسالة خارج المواعيد · ${p}awaymsg hours 10:00-22:00`],
      [autolistings.anyOn(ctx.state), `*٦. النشر*\n${p}flyer <رقم> صورة إعلان · ${p}adcopy <رقم> نص إعلان\n${p}autolistings on 10:00 في الجروب: عقار كل يوم\n${p}brochure كتالوج PDF للعميل`],
      [Boolean(digest.get(ctx.state, ctx.chatId)), `*٧. يومك*\n${p}digest on 08:30 ملخص الصباح\n${p}viewing add <عميل> <عقار> بكرة 4م · ${p}lead follow <عميل> بكرة 10ص`],
    ];
    const next = steps.findIndex(([ok]) => !ok);
    return ctx.reply(
      [
        "🏠 *دليل أدوات العقارات*",
        "",
        ...steps.map(([ok, text], i) => `${done(ok)} ${text}${i === next ? "\n👈 *الخطوة التالية*" : ""}`),
        "",
        `📋 كل الأوامر: ${p}help realestate · تفاصيل أي أمر: ${p}help <الأمر>`,
        `📍 المواقع: رد على اللوكيشن أو لينك جوجل ماب بـ ${p}listing loc <رقم> · ولو العميل بعت موقعه رد عليه بـ ${p}listings near تظهر له أقرب العقارات`,
        `📊 الحاسبات: ${p}installments · ${p}mortgage · ${p}commission · ${p}ppm · ${p}roi`,
        `💾 النسخ الاحتياطي: ${p}backup · ${p}backup photos · ${p}export listings`,
      ].join("\n\n"),
    );
  },
};
