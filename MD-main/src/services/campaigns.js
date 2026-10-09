"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");
const leads = require("./leads");
const requests = require("./requests");
const ownerReport = require("./ownerreport");
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
  `📣 ${c.kind === "message" ? `رسالة #${c.id} للعملاء` : c.kind === "owners" ? `تقارير الملاك #${c.id}` : c.kind === "nudge" ? `متابعة #${c.id} للعملاء اللي ما ردوش` : c.kind === "welcome" ? `ترحيب #${c.id} بالعملاء الجدد` : `حملة ${c.mode === "drop" ? "تخفيض " : ""}#${c.id} للعقار #${c.listing}`}: ✅ ${c.sent.length} أُرسلت${c.failed.length ? ` · ❌ ${c.failed.length} فشلت` : ""}${c.skipped ? ` · ⏭️ ${c.skipped} تخطي` : ""} من ${c.total}`;

// ---- welcoming new clients (.leads welcome) -----------------------------------------------

const DEFAULT_WELCOME = "أهلاً {name} 👋\nشكراً لاهتمامك{ad}. معاك {agent}.\nلسه بتدور على {wish}؟ قولي المنطقة والميزانية اللي تناسبك وأبعتلك أنسب الاختيارات.";

/** New clients nobody has contacted yet, with a number, who haven't said stop. */
const welcomeTargets = (state) =>
  leads
    .all(state)
    .filter((l) => l.status === "new" && l.phone && !l.optedOut && !l.welcomedAt && !l.lastSentAt)
    .sort((a, b) => a.created - b.created || a.id - b.id); // whoever has waited longest first

/** The welcome a client gets: the agent's wording (.agent welcome) or the default, the best match, and how to stop. */
const welcomeText = (state, lead) => personal(state, lead, re.agent(state).welcome || DEFAULT_WELCOME);

/** A message template filled for one client ({name} {ad} {wish} {agent}), with the best match and the opt-out line. */
function personal(state, lead, template) {
  const a = re.agent(state);
  const wish = requests.describe({ type: lead.type || "عقار", deal: lead.deal, location: lead.location, rooms: lead.rooms, min: lead.min, max: lead.max }, a.currency);
  const text = String(template)
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

// ---- following up with clients who went quiet (.agent nudge on) --------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const NUDGE_AFTER = 3 * DAY_MS; // no reply for 3 days after something was sent …
const NUDGE_UNTIL = 14 * DAY_MS; // … and not more than 14 (older ones are left to the agent)
const NUDGE_MAX = 30; // a day
const ACTIVE = new Set(["new", "contacted", "viewing", "negotiating"]);
const DEFAULT_NUDGE = "أهلاً {name} 👋\nلسه بتدور على {wish}؟ لو حابب أبعتلك اختيارات جديدة، قولي الميزانية والمنطقة اللي تناسبك 🙏\n{agent}";

/** Active clients who haven't answered what was last sent (3–14 days ago), not yet followed up for it; oldest first. */
const nudgeTargets = (state, now = Date.now()) =>
  leads
    .all(state)
    .filter((l) => ACTIVE.has(l.status) && l.phone && !l.optedOut && leads.awaitingReply(l) && !(l.nudgedAt > l.lastSentAt) && now - l.lastSentAt >= NUDGE_AFTER && now - l.lastSentAt < NUDGE_UNTIL)
    .sort((a, b) => a.lastSentAt - b.lastSentAt)
    .slice(0, NUDGE_MAX);

const nudgeText = (state, lead) => personal(state, lead, re.agent(state).nudgetext || DEFAULT_NUDGE);

/**
 * Once a day, from the start of the sending hours, queue the follow-ups as a campaign (told to
 * the owner when done). @returns {object|null} the campaign started
 */
function planNudges(app, now = Date.now()) {
  if (!re.agent(app.state).nudge) return null;
  const s = store(app.state);
  const { day, minutes } = zoneNow(app.config.bot.timezone, now);
  if (s.data.nudgeDay === day || minutes < parseClock(settings(app.state).from)) return null;
  s.update((d) => (d.nudgeDay = day));
  return queueAuto(app, "nudge", nudgeTargets(app.state, now).map((l) => l.id), now);
}

/** An automatic campaign (by the bot, reported to the owner) — unless one of its kind is running. */
function queueAuto(app, kind, queue, now) {
  if (!queue.length || running(app.state).some((c) => c.kind === kind) || running(app.state).length >= MAX_RUNNING) return null;
  const owner = app.config.owners.numbers[0];
  return store(app.state).update((d) => {
    const id = ++d.seq;
    d.items[id] = { id, kind, queue, total: queue.length, sent: [], failed: [], skipped: 0, status: "running", by: "bot", chat: owner ? `${owner}@s.whatsapp.net` : null, created: now };
    return d.items[id];
  });
}

// ---- a message to clients: occasions and announcements (.blast msg) -----------------------

const MAX_MESSAGE = 1000;
const MAX_AUDIENCE = 1000;
const imagePath = (config, name) => path.join(config.paths.data, "campaigns", path.basename(name));

/**
 * "التجمع شقة viewing" → who it goes to: statuses, a type, sale/rent, words of the area.
 * Without a status, everyone but lost clients; "all" includes them.
 */
function parseAudience(text) {
  const out = { statuses: [], words: [], all: false };
  for (const t of String(text || "").split(/[\s,،]+/).filter(Boolean)) {
    if (/^(all|everyone|الكل|كل)$/i.test(t)) out.all = true;
    else if (re.dealIn(t)) out.deal = re.dealIn(t); // before statuses: "بيع" is sale here, not a won deal
    else if (re.typeIn(t)) out.type = re.typeIn(t);
    else if (leads.statusFrom(t)) out.statuses.push(leads.statusFrom(t));
    else out.words.push(t);
  }
  return out;
}

const audienceText = (a) =>
  [a.statuses.length ? a.statuses.join(", ") : a.all ? "everyone" : "everyone but lost", a.type, a.deal, a.words.length && `area: ${a.words.join(" / ")}`].filter(Boolean).join(" · ");

/** Clients with a number who haven't said stop, matching the audience; oldest first. */
const messageTargets = (state, a) =>
  leads
    .all(state)
    .filter((l) => l.phone && !l.optedOut)
    .filter((l) => (a.statuses.length ? a.statuses.includes(l.status) : a.all || l.status !== "lost"))
    .filter((l) => !a.type || l.type === a.type)
    .filter((l) => !a.deal || l.deal === a.deal)
    .filter((l) => !a.words.length || a.words.some((w) => (l.location || "").includes(w)))
    .sort((x, y) => x.id - y.id)
    .slice(0, MAX_AUDIENCE);

/** Ready greetings for the occasions (".blast msg رمضان"); {name} and {agent} are filled in. */
const OCCASIONS = {
  ramadan: { words: ["رمضان", "ramadan"], text: "رمضان كريم يا {name} 🌙\nكل سنة وانت طيب، وربنا يتقبل منا ومنكم صالح الأعمال.\n{agent}" },
  eid: { words: ["عيد", "العيد", "عيد الفطر", "الفطر", "eid"], text: "عيد سعيد يا {name} 🎉\nكل سنة وانت وعيلتك بألف خير، وينعاد عليكم بالصحة والسعادة.\n{agent}" },
  adha: { words: ["الأضحى", "الاضحى", "عيد الأضحى", "عيد الاضحى", "adha"], text: "عيد أضحى مبارك يا {name} 🐑\nكل سنة وانت طيب، وينعاد عليك وعلى عيلتك بالخير.\n{agent}" },
  newyear: { words: ["سنة جديدة", "السنة الجديدة", "رأس السنة", "راس السنة", "newyear", "new year"], text: "سنة جديدة سعيدة يا {name} ✨\nنتمنالك سنة مليانة خير ونجاح، ولو بتفكر في عقار جديد السنة دي أنا موجود.\n{agent}" },
};
/** The ready greeting a whole message names ("رمضان", "عيد الأضحى"), or null. */
const occasion = (text) => Object.values(OCCASIONS).find((o) => o.words.includes(String(text || "").trim().toLowerCase()))?.text || null;

/** The text one client gets: {name} and {agent} filled in, and how to stop. */
const messageText = (lead, text, agent = {}) =>
  `${String(text)
    .replace(/\{agent\}/g, [agent.name, agent.company].filter(Boolean).length ? `— ${[agent.name, agent.company].filter(Boolean).join(" · ")}` : "")
    .replace(/ ?يا \{name\}/g, lead.name ? ` يا ${lead.name}` : "") // no name: no dangling "يا"
    .replace(/\{name\}/g, lead.name || "")
    .replace(/ {2,}/g, " ")
    .replace(/ ([،.؟!,])/g, "$1")
    .trim()}\n\n${OPT_OUT_LINE}`;

function startMessage(state, { by, chat, text, image, audience, startAt }, now = Date.now()) {
  const t = String(text || "").trim();
  if (t.length < 2 || t.length > MAX_MESSAGE) throw new UserError(`The message is 2 to ${MAX_MESSAGE} characters.`);
  if (running(state).some((c) => c.kind === "message")) throw new UserError("A message to clients is already being sent (.campaigns). Wait for it, or stop it.");
  if (running(state).length >= MAX_RUNNING) throw new UserError(`${MAX_RUNNING} campaigns are already running. Wait for one to finish or stop one (.campaigns).`);
  const queue = messageTargets(state, audience).map((l) => l.id);
  if (!queue.length) throw new UserError("No client matches (with a number, and who hasn't said stop).");
  return store(state).update((d) => {
    const id = ++d.seq;
    d.items[id] = { id, kind: "message", text: t, ...(image ? { image } : {}), ...(startAt > now ? { startAt } : {}), audience: audienceText(audience), queue, total: queue.length, sent: [], failed: [], skipped: 0, status: "running", by, chat, created: now };
    return d.items[id];
  });
}

/** A finished or stopped message campaign's picture is deleted (it was only kept for sending). */
function dropImage(config, c) {
  if (!c?.image) return;
  try {
    fs.rmSync(imagePath(config, c.image), { force: true });
  } catch {
    /* already gone, or locked: a leftover picture does no harm */
  }
}

// ---- weekly reports to listings' owners (.agent ownerreports on) --------------------------

const weekday = (timeZone, now) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(now));

/**
 * On Saturdays, from the start of the sending hours, queue a marketing report to the owner of
 * each available listing with something to report (see ownerreport.weeklyTargets).
 */
function planOwnerReports(app, now = Date.now()) {
  if (!re.agent(app.state).ownerreports) return null;
  const s = store(app.state);
  const tz = app.config.bot.timezone;
  const { day, minutes } = zoneNow(tz, now);
  if (weekday(tz, now) !== "Sat" || s.data.ownersDay === day || minutes < parseClock(settings(app.state).from)) return null;
  s.update((d) => (d.ownersDay = day));
  return queueAuto(app, "owners", ownerReport.weeklyTargets(app.state, now).map((l) => l.id), now);
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
  const book = agent.booking ? `\n🗓️ لحجز معاينة ابعت: معاينة ${listing.id}` : "";
  return `${hi}${head}\n\n${re.card(listing, agent)}\n\nللاستفسار رد على الرسالة أو أرسل: #${listing.id}${book}\n${OPT_OUT_LINE}`;
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
  planNudges(app, now);
  planOwnerReports(app, now);
  if (s.data.day.count >= set.perDay) return "cap";
  if (now < (s.data.next || 0)) return "gap";
  // The oldest running campaign that is due (an automatic one waits 30 minutes for photos).
  const c = running(app.state).find((x) => !x.startAt || x.startAt <= now);
  if (!c) return "idle";

  const notify = (text) => (c.chat ? app.sock.sendMessage(c.chat, { text }).catch(() => {}) : undefined);
  const finish = async (status, why = "") => {
    s.update((d) => Object.assign(d.items[c.id], { status, queue: [], ended: now }));
    dropImage(app.config, c);
    await notify(`${summary(get(app.state, c.id))}${why ? `\n${why}` : ""}`);
    return "done";
  };
  const welcome = c.kind === "welcome";
  const msg = c.kind === "message";
  const nudge = c.kind === "nudge";
  const owners = c.kind === "owners";
  const listing = c.listing ? re.get(app.state, c.listing) : null;
  if (c.listing && (!listing || listing.status !== "available")) return finish("stopped", `⏹️ أُوقفت: العقار #${c.listing} لم يعد متاحاً.`);
  if (c.mode === "drop" && !re.discount(listing, now)) return finish("stopped", `⏹️ أُوقفت: سعر #${c.listing} لم يعد مخفّضاً.`);
  if (!c.queue.length) return finish("done");

  const nextId = c.queue[0];
  s.update((d) => d.items[c.id].queue.shift());
  const skip = async () => {
    s.update((d) => d.items[c.id].skipped++);
    if (!get(app.state, c.id).queue.length) return finish("done");
    return "skipped";
  };
  /** One message: sent or failed, counted towards the day, then a random gap so the timing isn't mechanical. */
  const attempt = async (target, phone, deliver) => {
    let outcome = "sent";
    try {
      const jid = `${phone}@s.whatsapp.net`;
      const [found] = (await app.sock.onWhatsApp?.(jid).catch(() => null)) || [];
      if (found && !found.exists) throw new Error("not on WhatsApp");
      await deliver(jid);
      s.update((d) => d.items[c.id].sent.push(target));
    } catch (err) {
      outcome = "failed";
      app.log.warn({ campaign: c.id, target, err: err.message }, "campaign message not sent");
      s.update((d) => d.items[c.id].failed.push(target));
    }
    s.update((d) => {
      d.day.count++;
      d.next = now + Math.round((set.gapMin + rand() * (set.gapMax - set.gapMin)) * 1000);
    });
    if (!get(app.state, c.id).queue.length) await finish("done");
    return outcome;
  };

  if (owners) {
    // A weekly owner report: skipped if the listing was sold, reported or switched off meanwhile.
    const l = re.get(app.state, nextId);
    if (!l || !ownerReport.weeklyDue(app.state, l, now)) return skip();
    return attempt(l.id, l.owner.phone, () => ownerReport.deliver(app, l, now));
  }

  const lead = leads.get(app.state, nextId);
  // Skipped: gone, no number, said stop, or (since it was queued) already got this listing / was contacted.
  const stale = welcome
    ? lead && (lead.status !== "new" || lead.welcomedAt || lead.lastSentAt)
    : nudge
      ? lead && (!ACTIVE.has(lead.status) || !leads.awaitingReply(lead) || lead.nudgedAt > lead.lastSentAt) // replied, closed or followed up meanwhile
      : msg
      ? false // a message goes to everyone queued (a stop request is checked below)
      : c.mode === "drop"
      ? lead && lead.dropNotified?.[listing.id] === listing.price
      : lead && (lead.sentListings || []).includes(listing.id);
  if (!lead || !lead.phone || lead.optedOut || stale) return skip();

  return attempt(lead.id, lead.phone, async (jid) => {
    if (welcome) {
      await app.sock.sendMessage(jid, { text: welcomeText(app.state, lead) });
      leads.markWelcomed(app.state, lead.id, c.by, now);
    } else if (nudge) {
      await app.sock.sendMessage(jid, { text: nudgeText(app.state, lead) });
      leads.markNudged(app.state, lead.id, c.by, now);
    } else if (msg) {
      // Not a listing: no reply tracking or follow-up starts from it, only a note.
      const text = messageText(lead, c.text, re.agent(app.state));
      const file = c.image && imagePath(app.config, c.image);
      await app.sock.sendMessage(jid, file && fs.existsSync(file) ? { image: fs.readFileSync(file), caption: text } : { text });
      leads.note(app.state, lead.id, c.by, `أُرسلت له رسالة (#${c.id}): ${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}`, now);
    } else {
      const text = message(listing, lead, re.agent(app.state), c.mode);
      const [photo] = re.photos(app.config, listing);
      await app.sock.sendMessage(jid, photo ? { image: fs.readFileSync(photo), caption: text } : { text });
      leads.markSent(app.state, lead.id, listing.id, c.by, `أُرسل له ${c.mode === "drop" ? "تخفيض سعر " : ""}العقار #${listing.id} (حملة #${c.id})`, now);
      if (c.mode === "drop") leads.update(app.state, lead.id, { dropNotified: { ...(lead.dropNotified || {}), [listing.id]: listing.price } }, now);
    }
  });
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

module.exports = { targets, start, startWelcome, startMessage, occasion, OCCASIONS, messageTargets, messageText, parseAudience, audienceText, dropImage, imagePath, MAX_MESSAGE, welcomeTargets, welcomeText, DEFAULT_WELCOME, nudgeTargets, nudgeText, planNudges, planOwnerReports, DEFAULT_NUDGE, stop, get, all, running, settings, setLimit, setHours, estimate, summary, message, tick, startCampaignLoop, OPT_OUT_LINE, DEFAULTS };
