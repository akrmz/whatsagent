"use strict";

const re = require("./realestate");
const leads = require("./leads");
const viewings = require("./viewings");
const owners = require("./owners");
const route = require("./viewingroute");
const rentals = require("./rentals");
const hotleads = require("./hotleads");
const weekly = require("./weekly");
const health = require("./listinghealth");
const slowlistings = require("./slowlistings");
const assistant = require("./assistant");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * The agent's morning summary (.digest): today's viewings and follow-ups, new clients,
 * clients nobody has touched for a week, and the catalogue. Once a day at a set time in the
 * chat where it was turned on (usually the agent's own chat), up to 3 hours late.
 *   DATA_DIR/digest.json { [chat]: { time, last } }
 */

const LATE_LIMIT_MIN = 180;
const STALE_DAYS = 7;
const QUIET_DAYS = 2;
const DAY = 86400 * 1000;
const ACTIVE = new Set(["new", "contacted", "viewing", "negotiating"]);

const store = (state) => state.store("digest", {});
const get = (state, chat) => store(state).data[chat] || null;
const set = (state, chat, time) => store(state).update((d) => (d[chat] = { ...(d[chat] || {}), time }));
const remove = (state, chat) => store(state).update((d) => delete d[chat]);

const hhmm = (t, timeZone) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

/** The summary text for "today" in the bot's time zone. */
function build(state, timeZone, now = Date.now()) {
  const today = zoneNow(timeZone, now).day;
  const isToday = (t) => zoneNow(timeZone, t).day === today;
  const cur = re.agent(state).currency;
  const all = leads.all(state);
  const todaysViewings = viewings.upcoming(state, now).filter((v) => isToday(v.at));
  const followUps = all.filter((l) => l.followUp && (isToday(l.followUp.at) || l.followUp.at < now)).sort((a, b) => a.followUp.at - b.followUp.at);
  const fresh = all.filter((l) => now - l.created < 24 * 3600 * 1000);
  const stale = all.filter((l) => ACTIVE.has(l.status) && !l.followUp && now - l.updated > STALE_DAYS * 86400 * 1000).sort((a, b) => a.updated - b.updated);
  const listings = re.all(state);
  const count = (s) => listings.filter((l) => l.status === s).length;

  const lines = [`📋 *ملخص اليوم* — ${today}`];
  lines.push("", `🗓️ *المعاينات اليوم (${todaysViewings.length})*`);
  lines.push(...(todaysViewings.length ? todaysViewings.map((v) => viewings.line(state, v, timeZone)) : ["لا توجد"]));
  if (todaysViewings.length >= 2) {
    // Several viewings: one link through them in order, and a warning when two are too close in time.
    const plan = route.dayPlan(state, timeZone, today, now);
    const tight = plan.stops.filter((x) => x.leg?.tight).length;
    if (plan.url) lines.push(`🗺️ الطريق بالترتيب: ${plan.url}`);
    if (tight) lines.push(`⚠️ ${tight === 1 ? "معاينة الوقت قبلها مش مكفي المشوار" : `${tight} معاينات الوقت قبلها مش مكفي المشوار`} — .viewings today`);
  }
  const open = viewings.pending(state, now).filter((v) => !isToday(v.at));
  if (open.length) lines.push(`📝 بدون نتيجة: ${open.slice(0, 6).map((v) => `#${v.id}`).join("، ")} — .viewing done <رقم> liked|thinking|no`);
  lines.push("", `⏰ *متابعات اليوم (${followUps.length})*`);
  lines.push(...(followUps.length ? followUps.slice(0, 15).map((l) => `${hhmm(l.followUp.at, timeZone)} ${leads.line(l, cur)}${l.followUp.note ? ` — ${l.followUp.note}` : ""}`) : ["لا توجد"]));
  // Clients the customer assistant handed over who haven't had a reply yet.
  const waiting = assistant.waiting(state, now);
  if (waiting.length) lines.push("", `🙋 *مستنيين ردك (${waiting.length})*`, ...waiting.slice(0, 8).map((w) => assistant.waitingLine(w, now)), ...(waiting.length > 8 ? ["… .assistant inbox"] : []));
  const top = hotleads.hot(state, 3, now);
  if (top.length) lines.push("", "🔥 *ابدأ بهؤلاء اليوم*", ...top.map((h) => hotleads.line(h, cur)));
  if (fresh.length) lines.push("", `🆕 *عملاء جدد آخر 24 ساعة (${fresh.length})*`, ...fresh.slice(0, 10).map((l) => leads.line(l, cur)));
  // Replies to what we sent, and clients who went quiet after it (2–14 days ago; older ones are in 💤).
  const replied = all.filter((l) => l.lastSentAt && l.lastMsgAt > l.lastSentAt && now - l.lastMsgAt < DAY).sort((a, b) => b.lastMsgAt - a.lastMsgAt);
  if (replied.length) lines.push("", `💬 *ردوا على ما أرسلته آخر 24 ساعة (${replied.length})*`, ...replied.slice(0, 8).map((l) => `${leads.line(l, cur)} — بخصوص ${leads.sentWhat(l)}`));
  const quiet = all
    .filter((l) => ACTIVE.has(l.status) && !l.optedOut && leads.awaitingReply(l) && now - l.lastSentAt >= QUIET_DAYS * DAY && now - l.lastSentAt < 14 * DAY)
    .sort((a, b) => a.lastSentAt - b.lastSentAt);
  if (quiet.length) {
    lines.push("", `📭 *أُرسل لهم عقار ولم يردوا (${quiet.length})*`);
    lines.push(...quiet.slice(0, 8).map((l) => `${leads.line(l, cur)} — ${leads.sentWhat(l)} منذ ${Math.floor((now - l.lastSentAt) / DAY)} يوم${l.nudgedAt > l.lastSentAt ? " · 🔔 تمت متابعته" : ""}`));
  }
  if (stale.length) {
    lines.push("", `💤 *بدون تواصل منذ ${STALE_DAYS}+ أيام (${stale.length})*`);
    lines.push(...stale.slice(0, 8).map((l) => `${leads.line(l, cur)} — منذ ${Math.floor((now - l.updated) / 86400000)} يوم`));
  }
  lines.push(...rentals.digestLines(state, today));
  lines.push("", `🏠 الكتالوج: ✅ ${count("available")} متاح · ⏳ ${count("reserved")} محجوز · 🔴 ${count("sold") + count("rented")} مباع/مؤجر`);
  const old = re.stale(state, 30, now);
  if (old.length) {
    lines.push(`🕸️ لم تُحدَّث منذ 30+ يوماً: ${old.slice(0, 8).map((l) => `#${l.id}`).join("، ")}${old.length > 8 ? " …" : ""} — هل ما زالت متاحة؟`);
    const askable = old.filter((l) => owners.contactOf(l) && !(l.ask && now - l.ask.at < 7 * 86400 * 1000)).slice(0, 5);
    if (askable.length) lines.push(`🔑 اسأل الملاك: .listing ask ${askable.map((l) => l.id).join(" ")}`);
  }
  // Brokers' units (from a channel or a forwarded post, no owner saved) go fast: a week unconfirmed is long.
  const recentlyAsked = (l) => l.ask && now - l.ask.at < 3 * 86400 * 1000;
  const brokers = re.stale(state, 7, now).filter((l) => !old.includes(l) && owners.contactOf(l)?.kind === "broker" && !recentlyAsked(l));
  if (brokers.length) lines.push(`🔗 وحدات سماسرة من غير تأكيد من 7+ أيام: ${brokers.slice(0, 8).map((l) => `#${l.id}`).join("، ")} — اسألهم: .listing ask ${brokers.slice(0, 5).map((l) => l.id).join(" ")}`);
  // Saturday, the start of the work week in Egypt: the week in numbers too, and what listings miss.
  if (new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(now)) === "Sat") {
    const c = health.counts(state, now);
    const missing = [c.photos && `📷 صور ${c.photos}`, c.price && `💰 سعر ${c.price}`, c.size && `📐 مساحة ${c.size}`, c.location && `📍 منطقة ${c.location}`].filter(Boolean);
    if (missing.length) lines.push(`🧹 عقارات ناقصها بيانات: ${missing.join(" · ")} — .listings check`);
    const slow = slowlistings.slow(state, { minDays: 60 }, now);
    if (slow.total) lines.push(`🐢 معروضة من 60+ يوم: ${slow.groups.map((g) => `${g.type} ${g.items.length}`).join(" · ")} — ليه مش بتتباع؟ .listings slow 60`);
    lines.push("", weekly.build(state, timeZone, now));
  }
  return lines.join("\n");
}

function isDue(entry, timeZone, now) {
  const { day, minutes } = zoneNow(timeZone, now);
  const at = parseClock(entry.time);
  return entry.last !== day && minutes >= at && minutes <= at + LATE_LIMIT_MIN;
}

const HELD = "🔒 ملخص الصباح متوقف هنا: الجروب فيه أعضاء مش من الفريق (المالك والـ sudo). شغّله في الشات الخاص مع البوت: .digest on 08:30";

/** True for a private chat, or a group whose members are all staff (see permissions.allStaff). */
async function staffOnlyGroup(app, chat) {
  if (!chat.endsWith("@g.us")) return true;
  const meta = await app.groups.get(app.sock, chat).catch(() => null);
  return Boolean(meta) && app.permissions.allStaff(meta.participants || [], [app.sock.user?.id, app.sock.user?.lid].filter(Boolean));
}

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    if (!isDue(entry, zone, now)) continue;
    s.update(() => (entry.last = zoneNow(zone, now).day));
    try {
      // A group that is no longer staff only (someone else joined) gets a note, not clients' details.
      const text = (await staffOnlyGroup(app, chat)) ? build(app.state, zone, now) : HELD;
      await app.sock.sendMessage(chat, { text });
      sent++;
    } catch (err) {
      app.log.warn({ err: err.message }, "could not send the daily digest");
    }
  }
  return sent;
}

function startDigestLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "digest loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { get, set, remove, build, isDue, runDue, startDigestLoop, STALE_DAYS };
