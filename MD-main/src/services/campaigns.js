"use strict";

const fs = require("node:fs");
const re = require("./realestate");
const leads = require("./leads");
const requests = require("./requests");
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
const KEEP_FINISHED = 30;
const OPT_OUT_LINE = "لإيقاف رسائل العروض أرسل: وقف";

const store = (state) => state.store("campaigns", { seq: 0, items: {}, settings: {}, day: { date: "", count: 0 }, next: 0 });
const settings = (state) => ({ ...DEFAULTS, ...store(state).data.settings });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => b.id - a.id);
const running = (state) => all(state).filter((c) => c.status === "running").sort((a, b) => a.id - b.id);

/** Clients a campaign for this listing would reach: matching, with a phone, not opted out, not sent it before. */
const targets = (state, listing, mode) =>
  mode === "drop"
    ? // A price drop goes to clients whose budget it now fits, whether or not they got the listing before,
      // except those already told about this price.
      leads
        .matchingLeads(state, listing)
        .filter(({ fit }) => !fit.over)
        .map(({ lead }) => lead)
        .filter((l) => l.phone && !l.optedOut && l.dropNotified?.[listing.id] !== listing.price)
    : leads
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

function start(state, listing, { by, chat, mode, startAt }, now = Date.now()) {
  if (running(state).some((c) => c.listing === listing.id)) throw new UserError(`A campaign for #${listing.id} is already running (.campaigns).`);
  if (running(state).length >= MAX_RUNNING) throw new UserError(`${MAX_RUNNING} campaigns are already running. Wait for one to finish or stop one (.campaigns).`);
  if (mode === "drop" && !re.discount(listing, now)) throw new UserError(`#${listing.id} has no price cut in the last 30 days. Lower it first: .listing edit ${listing.id} السعر: …`);
  const queue = targets(state, listing, mode).map((l) => l.id);
  if (!queue.length) throw new UserError(mode === "drop" ? `No client to tell about #${listing.id}'s new price: none fits it within budget, or they were all told already.` : `No client to send #${listing.id} to: none matches, or they all have it already or asked to stop.`);
  return store(state).update((d) => {
    const id = ++d.seq;
    d.items[id] = { id, listing: listing.id, ...(mode === "drop" ? { mode } : {}), ...(startAt > now ? { startAt } : {}), queue, total: queue.length, sent: [], failed: [], skipped: 0, status: "running", by, chat, created: now };
    // The file is rewritten on every message sent, so only the latest finished campaigns are kept.
    const finished = Object.values(d.items).filter((c) => c.status !== "running").sort((a, b) => b.id - a.id);
    for (const old of finished.slice(KEEP_FINISHED)) delete d.items[old.id];
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

const summary = (c) =>
  `📣 ${c.kind === "welcome" ? `ترحيب #${c.id} بالعملاء الجدد` : `حملة ${c.mode === "drop" ? "تخفيض " : ""}#${c.id} للعقار #${c.listing}`}: ✅ ${c.sent.length} أُرسلت${c.failed.length ? ` · ❌ ${c.failed.length} فشلت` : ""}${c.skipped ? ` · ⏭️ ${c.skipped} تخطي` : ""} من ${c.total}`;

// ---- welcoming new clients (.leads welcome) -----------------------------------------------

const DEFAULT_WELCOME = "أهلاً {name} 👋\nشكراً لاهتمامك{ad}. معاك {agent}.\nلسه بتدور على {wish}؟ قولي المنطقة والميزانية اللي تناسبك وأبعتلك أنسب الاختيارات.";

/** New clients nobody has contacted yet, with a number, who haven't said stop. */
const welcomeTargets = (state) =>
  leads
    .all(state)
    .filter((l) => l.status === "new" && l.phone && !l.optedOut && !l.welcomedAt && !l.lastSentAt)
    .sort((a, b) => a.created - b.created || a.id - b.id); // whoever has waited longest first

/** The welcome a client gets: the agent's wording (.agent welcome) or the default, the best match, and how to stop. */
function welcomeText(state, lead) {
  const a = re.agent(state);
  const wish = requests.describe({ type: lead.type || "عقار", deal: lead.deal, location: lead.location, rooms: lead.rooms, min: lead.min, max: lead.max }, a.currency);
  const text = String(a.welcome || DEFAULT_WELCOME)
    .replace(/\{name\}/g, lead.name || "")
    .replace(/\{ad\}/g, lead.campaign ? ` بإعلان "${lead.campaign}"` : "")
    .replace(/\{wish\}/g, wish)
    .replace(/\{agent\}/g, [a.name, a.company && `من ${a.company}`].filter(Boolean).join(" ") || "فريق المبيعات")
    .replace(/ {2,}/g, " ")
    .replace(/ ([،.؟!])/g, "$1"); // an empty placeholder can leave "لاهتمامك ." behind
  const [best] = leads.matchingListings(state, lead).filter((m) => !m.fit.over);
  const match = best ? `\n\n🏠 عندي حالياً: ${re.line(best.listing, a.currency)}\nللتفاصيل والصور أرسل: #${best.listing.id}` : "";
  return `${text}${match}\n\n${OPT_OUT_LINE}`;
}

function startWelcome(state, { by, chat }, now = Date.now()) {
  if (running(state).some((c) => c.kind === "welcome")) throw new UserError("A welcome is already being sent (.campaigns).");
  if (running(state).length >= MAX_RUNNING) throw new UserError(`${MAX_RUNNING} campaigns are already running. Wait for one to finish or stop one (.campaigns).`);
  const queue = welcomeTargets(state).map((l) => l.id);
  if (!queue.length) throw new UserError("No new client to welcome: everyone is contacted already, has no number, or asked to stop.");
  return store(state).update((d) => {
    const id = ++d.seq;
    d.items[id] = { id, kind: "welcome", queue, total: queue.length, sent: [], failed: [], skipped: 0, status: "running", by, chat, created: now };
    return d.items[id];
  });
}

/** The message a client gets. */
function message(listing, lead, agent, mode) {
  const hi = lead.name ? `أهلاً ${lead.name} 👋\n` : "أهلاً 👋\n";
  const cut = mode === "drop" && re.discount(listing);
  const head = cut
    ? `📉 *نزل سعره!*${(lead.sentListings || []).includes(listing.id) ? " العقار اللي بعتهولك قبل كده" : ""}\nبقى ${re.shortAr(listing.price)} بدل ${re.shortAr(cut.was)} ${agent.currency || "جنيه"} (خصم ${cut.pct}%)`
    : "عندي عقار مناسب لطلبك:";
  return `${hi}${head}\n\n${re.card(listing, agent)}\n\nللاستفسار رد على الرسالة أو أرسل: #${listing.id}\n${OPT_OUT_LINE}`;
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
  // The oldest running campaign that is due (an automatic one waits 30 minutes for photos).
  const c = running(app.state).find((x) => !x.startAt || x.startAt <= now);
  if (!c) return "idle";

  const notify = (text) => (c.chat ? app.sock.sendMessage(c.chat, { text }).catch(() => {}) : undefined);
  const finish = async (status, why = "") => {
    s.update((d) => Object.assign(d.items[c.id], { status, queue: [], ended: now }));
    await notify(`${summary(get(app.state, c.id))}${why ? `\n${why}` : ""}`);
    return "done";
  };
  const welcome = c.kind === "welcome";
  const listing = welcome ? null : re.get(app.state, c.listing);
  if (!welcome && (!listing || listing.status !== "available")) return finish("stopped", `⏹️ أُوقفت: العقار #${c.listing} لم يعد متاحاً.`);
  if (c.mode === "drop" && !re.discount(listing, now)) return finish("stopped", `⏹️ أُوقفت: سعر #${c.listing} لم يعد مخفّضاً.`);
  if (!c.queue.length) return finish("done");

  const leadId = c.queue[0];
  s.update((d) => d.items[c.id].queue.shift());
  const lead = leads.get(app.state, leadId);
  // Skipped: gone, no number, said stop, or (since it was queued) already got this listing / was contacted.
  const stale = welcome
    ? lead && (lead.status !== "new" || lead.welcomedAt || lead.lastSentAt)
    : c.mode === "drop"
      ? lead && lead.dropNotified?.[listing.id] === listing.price
      : lead && (lead.sentListings || []).includes(listing.id);
  if (!lead || !lead.phone || lead.optedOut || stale) {
    s.update((d) => d.items[c.id].skipped++);
    if (!get(app.state, c.id).queue.length) return finish("done");
    return "skipped";
  }

  let outcome = "sent";
  try {
    const jid = `${lead.phone}@s.whatsapp.net`;
    const [found] = (await app.sock.onWhatsApp?.(jid).catch(() => null)) || [];
    if (found && !found.exists) throw new Error("not on WhatsApp");
    if (welcome) {
      await app.sock.sendMessage(jid, { text: welcomeText(app.state, lead) });
      leads.markWelcomed(app.state, lead.id, c.by, now);
    } else {
      const text = message(listing, lead, re.agent(app.state), c.mode);
      const [photo] = re.photos(app.config, listing);
      await app.sock.sendMessage(jid, photo ? { image: fs.readFileSync(photo), caption: text } : { text });
      leads.markSent(app.state, lead.id, listing.id, c.by, `أُرسل له ${c.mode === "drop" ? "تخفيض سعر " : ""}العقار #${listing.id} (حملة #${c.id})`, now);
      if (c.mode === "drop") leads.update(app.state, lead.id, { dropNotified: { ...(lead.dropNotified || {}), [listing.id]: listing.price } }, now);
    }
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

module.exports = { targets, start, startWelcome, welcomeTargets, welcomeText, DEFAULT_WELCOME, stop, get, all, running, settings, setLimit, setHours, estimate, summary, message, tick, startCampaignLoop, OPT_OUT_LINE, DEFAULTS };
