"use strict";

const { UserError } = require("../core/errors");
const re = require("./realestate");
const leads = require("./leads");
const team = require("./team");

/**
 * Property viewings (.viewing): a client, a listing and a time. The agent gets a reminder an
 * hour before, in the chat where it was booked; the client can get a confirmation. Two hours
 * after, the agent is asked how it went (.viewing done).
 *   DATA_DIR/viewings.json { seq, items: { [id]: { id, lead, listing, at, chat, by, reminded?, asked?, outcome? } } }
 * Viewings are dropped a day after they happened once the outcome is recorded, else after 7 days.
 */

const REMIND_BEFORE_MS = 60 * 60 * 1000;
const KEEP_AFTER_MS = 24 * 60 * 60 * 1000; // after a viewing with an outcome
const KEEP_PENDING_MS = 7 * 24 * 60 * 60 * 1000; // without one (so it can still be recorded)
const MAX_VIEWINGS = 2000;

const store = (state) => state.store("viewings", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;

/** Upcoming (and today's past) viewings, soonest first. */
const upcoming = (state, now = Date.now()) =>
  Object.values(store(state).data.items)
    .filter((v) => v.at > now - KEEP_AFTER_MS)
    .sort((a, b) => a.at - b.at);

function add(state, { lead, listing, at, chat, by, notifyClient = false }, now = Date.now()) {
  if (!leads.get(state, lead)) throw new UserError(`There is no client #${lead}.`);
  if (!re.get(state, listing)) throw new UserError(`There is no listing #${listing}.`);
  if (at < now) throw new UserError("That time has already passed.");
  const v = store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_VIEWINGS) throw new UserError("Too many viewings saved.");
    const id = ++d.seq;
    d.items[id] = { id, lead, listing, at, chat, by, bookedAt: now, ...(notifyClient ? { notifyClient: true } : {}) };
    return d.items[id];
  });
  team.record(state, by, "viewings", 1, now);
  return v;
}

/** After two clients are merged: their viewings belong to the one kept. @returns {number} moved */
function reassign(state, fromLead, toLead) {
  let n = 0;
  store(state).update((d) => {
    for (const v of Object.values(d.items)) if (v.lead === fromLead) (v.lead = toLead), n++;
  });
  return n;
}

const remove = (state, id) =>
  store(state).update((d) => {
    const v = d.items[id];
    if (!v) throw new UserError(`There is no viewing #${id}.`);
    delete d.items[id];
    return v;
  });

const when = (t, timeZone) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(t));

/** "🗓️ #3 · الخميس ٩ أكتوبر ٤:٠٠ م — شقة التجمع (#12) مع أحمد (#5)" */
function line(state, v, timeZone) {
  const l = re.get(state, v.listing);
  const c = leads.get(state, v.lead);
  return `🗓️ *#${v.id}* ${when(v.at, timeZone)} — ${l ? `${l.type || "عقار"}${l.location ? ` ${l.location.slice(0, 30)}` : ""} (#${l.id})` : `#${v.listing}`} مع ${c ? `${c.name || "عميل"} (#${c.id})` : `#${v.lead}`}`;
}

/** The message a client gets when a viewing is booked. */
function confirmation(state, v, timeZone) {
  const l = re.get(state, v.listing);
  const c = leads.get(state, v.lead);
  const a = re.agent(state);
  return [
    `${c?.name ? `أهلاً ${c.name} 👋` : "أهلاً 👋"}`,
    `تم تأكيد موعد معاينة ${l?.type || "العقار"}${l?.location ? ` في ${l.location}` : ""}`,
    `🗓️ ${when(v.at, timeZone)}`,
    re.contactLine(a) ? `\n${re.contactLine(a)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- outcomes ----------------------------------------------------------------------------

const RESULTS = {
  liked: { ar: "👍 أعجبه", words: ["liked", "like", "yes", "good", "أعجبه", "اعجبه", "عجبه", "عجبها", "أعجبها", "اعجبها", "مهتم", "👍"] },
  thinking: { ar: "🤔 بيفكر", words: ["thinking", "maybe", "think", "بيفكر", "يفكر", "محتار", "متردد", "ربما"] },
  no: { ar: "👎 لم يعجبه", words: ["no", "not", "disliked", "no-interest", "معجبهوش", "مش عاجبه", "لم يعجبه", "لا", "👎"] },
  noshow: { ar: "🚫 لم يحضر", words: ["noshow", "no-show", "absent", "محضرش", "ماحضرش", "ماجاش", "مجاش", "غاب", "غايب", "🚫"] },
};
const resultFrom = (w) => Object.keys(RESULTS).find((k) => RESULTS[k].words.includes(String(w || "").toLowerCase())) || null;
const ASK_AFTER_MS = 2 * 60 * 60 * 1000; // ask how it went 2 hours after the viewing …
const ASK_UNTIL_MS = 12 * 60 * 60 * 1000; // … unless 12 hours have passed (the morning summary lists it then)

/**
 * Records how a viewing went, on the viewing and in the client's history. A client who liked
 * it moves to "negotiating" (unless further along already).
 */
function done(state, id, result, note, by, now = Date.now()) {
  const v = get(state, id);
  if (!v) throw new UserError(`There is no viewing #${id} (viewings are kept 7 days).`);
  if (v.at > now) throw new UserError(`Viewing #${id} hasn't happened yet.`);
  store(state).update((d) => (d.items[id].outcome = { result, note: note || undefined, at: now, by }));
  const c = leads.get(state, v.lead);
  if (c) {
    if (result === "liked" && ["new", "contacted", "viewing"].includes(c.status)) leads.update(state, c.id, { status: "negotiating" }, now);
    if (result === "noshow") leads.update(state, c.id, { noShows: (c.noShows || 0) + 1 }, now);
    leads.note(state, c.id, by, `نتيجة معاينة #${v.listing}: ${RESULTS[result].ar}${note ? ` — ${note}` : ""}`, now);
  }
  return get(state, id);
}

/** Viewings that have happened (an hour ago or more) without an outcome yet, oldest first. */
const pending = (state, now = Date.now()) =>
  Object.values(store(state).data.items)
    .filter((v) => !v.outcome && v.at < now - 60 * 60 * 1000)
    .sort((a, b) => a.at - b.at);

// ---- calendar ----------------------------------------------------------------------------

const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines longer than 75 bytes are folded (RFC 5545), without splitting a UTF-8 character. */
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Upcoming viewings as an iCalendar file (one hour each), for Google Calendar or a phone. */
function ics(state, timeZone, now = Date.now()) {
  const events = upcoming(state, now)
    .filter((v) => v.at > now)
    .flatMap((v) => {
      const l = re.get(state, v.listing);
      const c = leads.get(state, v.lead);
      const what = l ? `${l.type || "عقار"}${l.location ? ` ${l.location}` : ""} (#${l.id})` : `#${v.listing}`;
      return [
        "BEGIN:VEVENT",
        `UID:viewing-${v.id}-${v.at}@whatsapp-bot`,
        `DTSTAMP:${icsDate(now)}`,
        `DTSTART:${icsDate(v.at)}`,
        `DTEND:${icsDate(v.at + 60 * 60 * 1000)}`,
        `SUMMARY:${icsText(`معاينة: ${what} — ${c?.name || "عميل"}`)}`,
        `DESCRIPTION:${icsText([c?.phone && `+${c.phone}`, l?.price && `${re.group(l.price)}`, `#${v.id}`].filter(Boolean).join(" · "))}`,
        ...(l?.location ? [`LOCATION:${icsText(l.location)}`] : []),
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsText(`معاينة: ${what}`)}`,
        "END:VALARM",
        "END:VEVENT",
      ];
    });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//whatsapp-bot//viewings//AR", "CALSCALE:GREGORIAN", `X-WR-TIMEZONE:${timeZone}`, ...events, "END:VCALENDAR"];
  return { text: `${lines.map(fold).join("\r\n")}\r\n`, count: events.filter((l) => l === "BEGIN:VEVENT").length };
}

const CLIENT_REMIND_MS = 2 * 60 * 60 * 1000;

/** The client's reminder on the day (the location pin follows when the listing has one). */
function clientReminder(state, v, timeZone) {
  const l = re.get(state, v.listing);
  const c = leads.get(state, v.lead);
  const a = re.agent(state);
  return [
    `${c?.name ? `أهلاً ${c.name} 👋` : "أهلاً 👋"}`,
    `تذكير بمعاد معاينة ${l?.type || "العقار"}${l?.location ? ` في ${l.location}` : ""}`,
    `🗓️ ${when(v.at, timeZone)}`,
    l?.geo ? "📍 الموقع على الخريطة في الرسالة اللي بعدها" : null,
    "لو حصل أي تغيير بلغني 🙏",
    re.contactLine(a) ? `\n${re.contactLine(a)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Reminds the agent an hour before each viewing (and the client 2 hours before, if booked with
 * "send"), asks how it went 2 hours after, and drops
 * old ones (a day after with an outcome, or after 7 days).
 */
async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const v of Object.values(s.data.items)) {
    if (v.at < now - (v.outcome ? KEEP_AFTER_MS : KEEP_PENDING_MS)) {
      s.update((d) => delete d.items[v.id]);
      continue;
    }
    if (!v.outcome && !v.asked && now - v.at >= ASK_AFTER_MS && now - v.at < ASK_UNTIL_MS) {
      s.update(() => (v.asked = true));
      await app.sock
        .sendMessage(v.chat, { text: `📝 *كيف كانت المعاينة؟*\n${line(app.state, v, zone)}\n.viewing done ${v.id} liked | thinking | no [ملاحظة]`, mentions: v.by ? [v.by] : [] })
        .then(() => sent++)
        .catch((err) => app.log.warn({ err: err.message }, "could not ask about a viewing"));
      continue;
    }
    // The client's reminder, 2 hours before, for viewings booked with "send" well ahead (a
    // booking made just now already got its confirmation).
    if (v.notifyClient && !v.clientReminded && v.at > now && v.at - now <= CLIENT_REMIND_MS && v.at - (v.bookedAt || 0) > CLIENT_REMIND_MS + REMIND_BEFORE_MS) {
      s.update(() => (v.clientReminded = true));
      const c = leads.get(app.state, v.lead);
      const l = re.get(app.state, v.listing);
      if (c?.phone) {
        const to = `${c.phone}@s.whatsapp.net`;
        try {
          await app.sock.sendMessage(to, { text: clientReminder(app.state, v, zone) });
          if (l?.geo) await app.sock.sendMessage(to, { location: { degreesLatitude: l.geo.lat, degreesLongitude: l.geo.lng, name: `${l.type || "عقار"}${l.location ? ` — ${l.location}` : ""}`.slice(0, 100) } });
          sent++;
        } catch (err) {
          app.log.warn({ err: err.message }, "could not send a client's viewing reminder");
        }
      }
    }
    if (v.reminded || v.at - now > REMIND_BEFORE_MS || v.at < now) continue;
    s.update(() => (v.reminded = true));
    const c = leads.get(app.state, v.lead);
    try {
      await app.sock.sendMessage(v.chat, {
        text: `⏰ *معاينة بعد ${Math.max(1, Math.round((v.at - now) / 60000))} دقيقة*\n${line(app.state, v, zone)}${c?.phone ? `\n📞 +${c.phone}` : ""}`,
        mentions: v.by ? [v.by] : [],
      });
      sent++;
    } catch (err) {
      app.log.warn({ err: err.message }, "could not send a viewing reminder");
    }
  }
  return sent;
}

function startViewingsLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "viewing reminder loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { add, remove, reassign, get, upcoming, line, confirmation, clientReminder, runDue, startViewingsLoop, when, done, pending, resultFrom, RESULTS, ics, fold, REMIND_BEFORE_MS };
