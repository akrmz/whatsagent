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
      [Boolean(a.autoleads), `*٤. استقبال الاستفسارات تلقائياً*\n${p}agent autoleads on — من يسأل عن #رقم يُحفظ كعميل وتصلك رسالة\n${p}agent catalog on — العميل يبعت "عقارات" فتوصله قائمة يتصفح منها\n${p}assistant on — مساعد ذكي يرد على أسئلة العملاء من عقاراتك (محتاج .setai)
${p}agent requests on — العميل يكتب طلبه ("عايز شقة في التجمع ميزانية 3 مليون") فيرد عليه البوت بأقرب العقارات ويحفظه`],
      [Boolean(ar.away || ar.greet), `*٥. الرد التلقائي*\n${p}greet on رسالة ترحيب لأول تواصل\n${p}awaymsg on رسالة خارج المواعيد · ${p}awaymsg hours 10:00-22:00`],
      [autolistings.anyOn(ctx.state), `*٦. النشر*\n${p}flyer <رقم> صورة إعلان · ${p}story <رقم> تصميم للحالة · ${p}collage <رقم> كولاج الصور · ${p}adcopy <رقم> نص إعلان\n${p}autolistings on 10:00 في الجروب: عقار كل يوم · ${p}statuspost daily 09:00 على حالتك كل يوم\n${p}brochure كتالوج PDF للعميل`],
      [Boolean(digest.get(ctx.state, ctx.chatId)), `*٧. يومك*\n${p}digest on 08:30 ملخص الصباح\n${p}viewing add <عميل> <عقار> بكرة 4م · ${p}lead follow <عميل> بكرة 10ص\nالعميل يحجز بنفسه: ${p}agent booking on (يبعت معاينة) · ${p}viewing hours 11:00-19:00\nبعد المعاينة: ${p}viewing done <رقم> liked|thinking|no · ${p}viewings ics لإضافة المواعيد لتقويم موبايلك`],
    ];
    const next = steps.findIndex(([ok]) => !ok);
    return ctx.reply(
      [
        "🏠 *دليل أدوات العقارات*",
        "",
        ...steps.map(([ok, text], i) => `${done(ok)} ${text}${i === next ? "\n👈 *الخطوة التالية*" : ""}`),
        "",
        `🤖 ${p}autopilot — كل الأتمتة في شاشة واحدة: إيه شغال، وإيه اتبعت النهارده`,
        `📋 كل الأوامر: ${p}help realestate · تفاصيل أي أمر: ${p}help <الأمر> · الدليل الكامل بالعربي: docs/REAL_ESTATE_AR.md`,
        `📍 المواقع: رد على اللوكيشن أو لينك جوجل ماب بـ ${p}listing loc <رقم> · ولو العميل بعت موقعه رد عليه بـ ${p}listings near تظهر له أقرب العقارات`,
        `📣 الحملات: ${p}blast <رقم> يعرض العملاء المناسبين للعقار ثم ${p}blast <رقم> go يرسله لهم بهدوء (رسالة كل دقيقة تقريباً، 40 في اليوم) · العميل يرسل "وقف" لإيقافها · ${p}blast msg + رسالتك في سطر جديد: تهنئة أو إعلان لكل العملاء · ${p}agent autoblast on: كل عقار جديد يتبعت للعملاء المناسبين تلقائياً بعد نص ساعة · ${p}agent nudge on: متابعة تلقائية للي ما ردش\n📉 بعد تخفيض السعر: ${p}blast <رقم> drop يبلّغ كل العملاء اللي السعر الجديد في ميزانيتهم، حتى اللي اتبعتلهم قبل كده`,
        `📲 إعلانات فيسبوك وإنستجرام: نزّل ملف العملاء من Leads Center وابعته للبوت، ورد عليه بـ ${p}import leads — يتحفظوا بمصدرهم واسم الإعلان، و ${p}restats يوريك أنهي إعلان جاب صفقات · ${p}leads welcome رسالة ترحيب لكل عميل جديد بهدوء (${p}agent welcome لكتابة نصك)`,
        `🌍 للأجانب: ${p}listing <رقم> en · ${p}flyer <رقم> en · ${p}story <رقم> en — والعميل يقدر يبعت "#12 en" · للمنطقة بالإنجليزي: Location EN: Mivida, New Cairo`,
        `🔑 الملاك: اكتب "المالك: الاسم 0100…" مع العقار (لا يظهر للعملاء) · ${p}listing ask <رقم> يسأل المالك "لسه متاح؟" ويوصلك رده · ${p}listing report <رقم> تقرير تسويق للمالك (send يبعته له، و${p}agent ownerreports on كل سبت)`,
        `🏗️ مشروعات المطورين: ${p}project add (المشروع، المطور، المنطقة، الوحدات، يبدأ من، المقدم، التقسيط، الاستلام) · ${p}projects التجمع مقدم 10% 8 سنين — بتظهر للعميل المناسب تلقائياً`,
        `👀 جروبات السماسرة: ${p}watch on داخل الجروب — البوت يقرأ العروض والطلبات ويبلغك لما عرض يناسب عملاءك أو طلب يطابق عقاراتك (من غير ما يكتب في الجروب) · ${p}feed العروض · ${p}feed requests الطلبات`,
        `🏘️ الإيجارات: ${p}rental add (العقار، المستأجر، الموبايل، الإيجار، يوم الاستحقاق، من، المدة) · ${p}rental paid <رقم> · ${p}rental receipt <رقم> send إيصال للمستأجر · ${p}rentals مين دفع ومين متأخر · ${p}rental auto <رقم> on تذكير المستأجر تلقائياً`,
        `🔥 ${p}leads hot مين تكلمه الأول · ${p}lead won <عميل> #<عقار> 3.1m 2.5% تسجيل صفقة وعمولتها · ${p}deals صفقات وعمولات الشهر · ${p}team أداء الفريق · ${p}weekly ملخص الأسبوع`,
        `💰 التسعير: ${p}market أسعار المتر من عقاراتك · ${p}market <رقم> هل السعر مناسب؟ · ${p}compare 3 7 مقارنة · ${p}offer <رقم> #<عميل> 10% 8 ربع سنوي عرض سعر PDF بجدول الأقساط`,
        `📊 الحاسبات: ${p}installments · ${p}mortgage · ${p}commission · ${p}ppm · ${p}roi`,
        `💾 النسخ الاحتياطي: ${p}backup · ${p}backup photos · ${p}export listings`,
      ].join("\n\n"),
    );
  },
};
