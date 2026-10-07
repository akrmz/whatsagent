"use strict";

const fs = require("node:fs");
const re = require("./realestate");
const leads = require("./leads");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");
const { UserError } = require("../core/errors");

/**
 * Campaigns (.blast 12): a listing sent to every saved client it suits, one at a time.
 * Sending is paced so the number doesn't look like a spammer to WhatsApp: a random gap
 * between messages, only during the day, and a daily cap across all campaigns. Clients who
 * send "وقف" are never sent offers again (until they send "اشتراك").
 *   DATA_DIR/campaigns.json { seq, items: { [id]: campaign }, settings, day: { date, count }, next }
 */

const DEFAULTS = { perDay: 40, from: "10:00", to: "21:00", gapMin: 45, gapMax: 90 };
const MAX_RUNNING = 5;
const OPT_OUT_LINE = "لإيقاف رسائل العروض أرسل: وقف";

const store = (state) => state.store("campaigns", { seq: 0, items: {}, settings: {}, day: { date: "", count: 0 }, next: 0 });
const settings = (state) => ({ ...DEFAULTS, ...store(state).data.settings });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => b.id - a.id);
const running = (state) => all(state).filter((c) => c.status === "running").sort((a, b) => a.id - b.id);

/** Clients a campaign for this listing would reach: matching, with a phone, not opted out, not sent it before. */
const targets = (state, listing) =>
  leads
    .matchingLeads(state, listing)
    .map(({ lead }) => lead)
    .filter((l) => l.phone && !l.optedOut && !(l.sentListings || []).includes(listing.id));

function setLimit(state, perDay) {
  if (!(Number.isInteger(perDay) && perDay >= 1 && perDay <= 100)) throw new UserError("The daily limit is a number from 1 to 100 (40 is a safe default).");
  store(state).update((d) => (d.settings.perDay = perDay));
}

function setHours(state, text) {
  const m = String(text || "").match(/^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/);
  const [from, to] = m ? [parseClock(m[1]), parseClock(m[2])] : [null, null];
  if (from === null || to === null || from >= to) throw new UserError("Hours like 10:00-21:00 (start before end, same day).");
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  store(state).update((d) => Object.assign(d.settings, { from: hhmm(from), to: hhmm(to) }));
}

function start(state, listing, { by, chat }, now = Date.now()) {
  if (running(state).some((c) => c.listing === listing.id)) throw new UserError(`A campaign for #${listing.id} is already running (.campaigns).`);
  if (running(state).length >= MAX_RUNNING) throw new UserError(`${MAX_RUNNING} campaigns are already running. Wait for one to finish or stop one (.campaigns).`);
  const queue = targets(state, listing).map((l) => l.id);
  if (!queue.length) throw new UserError(`No client to send #${listing.id} to: none matches, or they all have it already or asked to stop.`);
  return store(state).update((d) => {
    const id = ++d.seq;
    d.items[id] = { id, listing: listing.id, queue, total: queue.length, sent: [], failed: [], skipped: 0, status: "running", by, chat, created: now };
    return d.items[id];
  });
}

function stop(state, id) {
  const c = get(state, id);
  if (!c) throw new UserError(`There is no campaign #${id}.`);
  if (c.status !== "running") throw new UserError(`Campaign #${id} is already ${c.status}.`);
  store(state).update((d) => Object.assign(d.items[id], { status: "stopped", queue: [] }));
  return c;
}

/** Roughly how long the queue takes: the average gap per message, plus days for the daily cap. */
function estimate(state, count) {
  const s = settings(state);
  const minutes = Math.ceil((count * (s.gapMin + s.gapMax)) / 2 / 60);
  const days = Math.ceil(count / s.perDay);
  return { minutes, days };
}

const summary = (c) => `📣 حملة #${c.id} للعقار #${c.listing}: ✅ ${c.sent.length} أُرسلت${c.failed.length ? ` · ❌ ${c.failed.length} فشلت` : ""}${c.skipped ? ` · ⏭️ ${c.skipped} تخطي` : ""} من ${c.total}`;

/** The message a client gets. */
function message(listing, lead, agent) {
  const hi = lead.name ? `أهلاً ${lead.name} 👋\n` : "أهلاً 👋\n";
  return `${hi}عندي عقار مناسب لطلبك:\n\n${re.card(listing, agent)}\n\nللاستفسار رد على الرسالة أو أرسل: #${listing.id}\n${OPT_OUT_LINE}`;
}

/**
 * One step of the sending loop: at most one message, when it is time (gap, hours, daily cap).
 * @returns {Promise<string>} what happened ("sent", "failed", "skipped", "done", or why it waited)
 */
async function tick(app, now = Date.now(), rand = Math.random) {
  if (!app.sock || app.health.state !== "open") return "offline";
  const s = store(app.state);
  const set = settings(app.state);
  const { day, minutes } = zoneNow(app.config.bot.timezone, now);
  if (s.data.day.date !== day) s.update((d) => (d.day = { date: day, count: 0 }));
  if (minutes < parseClock(set.from) || minutes >= parseClock(set.to)) return "hours";
  if (s.data.day.count >= set.perDay) return "cap";
  if (now < (s.data.next || 0)) return "gap";
  const c = running(app.state)[0];
  if (!c) return "idle";

  const notify = (text) => (c.chat ? app.sock.sendMessage(c.chat, { text }).catch(() => {}) : undefined);
  const finish = async (status, why = "") => {
    s.update((d) => Object.assign(d.items[c.id], { status, queue: [], ended: now }));
    await notify(`${summary(get(app.state, c.id))}${why ? `\n${why}` : ""}`);
    return "done";
  };
  const listing = re.get(app.state, c.listing);
  if (!listing || listing.status !== "available") return finish("stopped", `⏹️ أُوقفت: العقار #${c.listing} لم يعد متاحاً.`);
  if (!c.queue.length) return finish("done");

  const leadId = c.queue[0];
  s.update((d) => d.items[c.id].queue.shift());
  const lead = leads.get(app.state, leadId);
  if (!lead || !lead.phone || lead.optedOut || (lead.sentListings || []).includes(listing.id)) {
    s.update((d) => d.items[c.id].skipped++);
    if (!get(app.state, c.id).queue.length) return finish("done");
    return "skipped";
  }

  let outcome = "sent";
  try {
    const jid = `${lead.phone}@s.whatsapp.net`;
    const [found] = (await app.sock.onWhatsApp?.(jid).catch(() => null)) || [];
    if (found && !found.exists) throw new Error("not on WhatsApp");
    const text = message(listing, lead, re.agent(app.state));
    const [photo] = re.photos(app.config, listing);
    await app.sock.sendMessage(jid, photo ? { image: fs.readFileSync(photo), caption: text } : { text });
    leads.markSent(app.state, lead.id, listing.id, c.by, `أُرسل له العقار #${listing.id} (حملة #${c.id})`, now);
    s.update((d) => d.items[c.id].sent.push(lead.id));
  } catch (err) {
    outcome = "failed";
    app.log.warn({ campaign: c.id, lead: lead.id, err: err.message }, "campaign message not sent");
    s.update((d) => d.items[c.id].failed.push(lead.id));
  }
  // Every attempt counts towards the day and waits a random gap, so the timing isn't mechanical.
  s.update((d) => {
    d.day.count++;
    d.next = now + Math.round((set.gapMin + rand() * (set.gapMax - set.gapMin)) * 1000);
  });
  if (!get(app.state, c.id).queue.length) await finish("done");
  return outcome;
}

function startCampaignLoop(app) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(app);
    } catch (err) {
      app.log.error({ err }, "campaign loop failed");
    } finally {
      busy = false;
    }
  }, 15 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { targets, start, stop, get, all, running, settings, setLimit, setHours, estimate, summary, message, tick, startCampaignLoop, OPT_OUT_LINE, DEFAULTS };
