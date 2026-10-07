"use strict";

const re = require("./realestate");
const leads = require("./leads");
const viewings = require("./viewings");
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
  lines.push("", `⏰ *متابعات اليوم (${followUps.length})*`);
  lines.push(...(followUps.length ? followUps.slice(0, 15).map((l) => `${hhmm(l.followUp.at, timeZone)} ${leads.line(l, cur)}${l.followUp.note ? ` — ${l.followUp.note}` : ""}`) : ["لا توجد"]));
  if (fresh.length) lines.push("", `🆕 *عملاء جدد آخر 24 ساعة (${fresh.length})*`, ...fresh.slice(0, 10).map((l) => leads.line(l, cur)));
  if (stale.length) {
    lines.push("", `💤 *بدون تواصل منذ ${STALE_DAYS}+ أيام (${stale.length})*`);
    lines.push(...stale.slice(0, 8).map((l) => `${leads.line(l, cur)} — منذ ${Math.floor((now - l.updated) / 86400000)} يوم`));
  }
  lines.push("", `🏠 الكتالوج: ✅ ${count("available")} متاح · ⏳ ${count("reserved")} محجوز · 🔴 ${count("sold") + count("rented")} مباع/مؤجر`);
  return lines.join("\n");
}

function isDue(entry, timeZone, now) {
  const { day, minutes } = zoneNow(timeZone, now);
  const at = parseClock(entry.time);
  return entry.last !== day && minutes >= at && minutes <= at + LATE_LIMIT_MIN;
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
      await app.sock.sendMessage(chat, { text: build(app.state, zone, now) });
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
