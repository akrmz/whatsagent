"use strict";

const re = require("../../services/realestate");
const campaigns = require("../../services/campaigns");
const autoreply = require("../../services/autoreply");
const autolistings = require("../../services/autolistings");
const statuspost = require("../../services/statuspost");
const rentals = require("../../services/rentals");
const viewings = require("../../services/viewings");
const feed = require("../../services/feed");
const { zoneNow } = require("../../services/gcschedule");

const on = (x) => (x ? "✅" : "⬜");

/**
 * Everything the bot does by itself for the real-estate work, on one screen: what is on, what
 * it sent today against the daily cap, what is waiting, and how to switch each thing.
 */
module.exports = {
  name: "autopilot",
  aliases: ["reauto", "taliqai"],
  category: "realestate",
  description:
    "لوحة الأتمتة — every automatic real-estate feature on one screen: what's on (auto-capture, request answers, the client menu, automatic campaigns, follow-ups, greetings, away replies, status posts, listing of the day, the morning summary, rent and viewing reminders, watched groups), today's campaign messages against the daily cap, running and waiting campaigns, and what is waiting to be sent, with the command to switch each. Owner and sudo users.",
  examples: [".autopilot"],
  permission: "sudo",
  cooldown: 3,
  async run(ctx) {
    const p = ctx.prefix;
    const s = ctx.state;
    const a = re.agent(s);
    const ar = autoreply.settings(s);
    const set = campaigns.settings(s);
    const tz = ctx.config.bot.timezone;
    const now = Date.now();
    const hhmm = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

    const day = zoneNow(tz, now).day;
    const store = s.store("campaigns", {}).data;
    const sentToday = store.day?.date === day ? store.day.count : 0;
    const running = campaigns.running(s);
    const statusDaily = autolistings.get(s, statuspost.STATUS_JID);
    const groupsDaily = Object.keys(s.store("listing-posts", {}).data).filter((k) => k !== statuspost.STATUS_JID).length;
    const digests = Object.values(s.store("digest", {}).data);
    const rentAuto = rentals.all(s).filter((r) => r.auto && rentals.standing(r, day).active).length;
    const clientReminders = viewings.upcoming(s, now).filter((v) => v.notifyClient && !v.clientReminded && v.at > now).length;
    const watched = Object.keys(feed.groups(s)).length;
    const welcomeWaiting = campaigns.welcomeTargets(s).length;
    const nudgeWaiting = campaigns.nudgeTargets(s, now).length;

    const lines = [
      "🤖 *الأتمتة — كل اللي البوت بيعمله لوحده*",
      "",
      "*الرد على العملاء*",
      `${on(a.autoleads)} حفظ اللي يسأل عن #رقم كعميل — ${p}agent autoleads on|off`,
      `${on(a.requests)} الرد على طلبات العملاء المكتوبة — ${p}agent requests on|off`,
      `${on(a.catalog)} قائمة العقارات للعملاء ("عقارات") — ${p}agent catalog on|off`,
      `${on(ar.greet)} ترحيب بأول تواصل — ${p}greet on <الرسالة> | off`,
      `${on(ar.away)} رد خارج مواعيد العمل — ${p}awaymsg on <الرسالة> | off`,
      "",
      "*الرسائل اللي البوت بيبدأها*",
      `${on(a.autoblast)} حملة تلقائية لكل عقار جديد — ${p}agent autoblast on|off`,
      `${on(a.nudge)} متابعة اللي ما ردوش (3–14 يوم)${nudgeWaiting ? ` — ${nudgeWaiting} مستحق` : ""} — ${p}agent nudge on|off`,
      `👋 عملاء جدد بدون ترحيب: ${welcomeWaiting}${welcomeWaiting ? ` — ${p}leads welcome` : ""}`,
      `📣 رسائل الحملات النهارده: ${sentToday} من ${set.perDay} · ${set.from}–${set.to} — ${p}blast limit · ${p}blast hours`,
      ...(running.length
        ? running.map((c) => `   ${c.startAt > now ? "🕒" : "▶️"} ${campaigns.summary(c)}${c.startAt > now ? ` — يبدأ ${hhmm(c.startAt)}` : ` — ${c.queue.length} متبقي`}`)
        : ["   لا توجد حملات جارية"]),
      "",
      "*مواعيد ثابتة*",
      `${on(statusDaily)} الحالة اليومية${statusDaily ? ` ${statusDaily.time}` : ""} — ${p}statuspost daily 09:00 | off`,
      `${on(groupsDaily)} عقار اليوم في الجروبات${groupsDaily ? ` (${groupsDaily} جروب)` : ""} — ${p}autolistings on 10:00`,
      `${on(digests.length)} ملخص الصباح${digests.length ? ` ${digests.map((d) => d.time).join("، ")}` : ""} — ${p}digest on 08:30`,
      `${on(rentAuto)} تذكير المستأجرين${rentAuto ? ` (${rentAuto} عقد)` : ""} — ${p}rental auto <رقم> on`,
      `🗓️ تذكيرات معاينة للعملاء في الانتظار: ${clientReminders}`,
      `${on(watched)} رصد جروبات السماسرة${watched ? ` (${watched} جروب)` : ""} — ${p}watch on`,
      "",
      "_العميل اللي يبعت \"وقف\" ما يوصلوش أي رسائل عروض. ابعت الحملات للناس اللي سألوك بس._",
    ];
    return ctx.reply(lines.join("\n"));
  },
};
