"use strict";

const { UserError } = require("../core/errors");
const re = require("./realestate");
const leads = require("./leads");

/**
 * Property viewings (.viewing): a client, a listing and a time. The agent gets a reminder an
 * hour before, in the chat where it was booked; the client can get a confirmation.
 *   DATA_DIR/viewings.json { seq, items: { [id]: { id, lead, listing, at, chat, by, reminded? } } }
 * Viewings more than a day old are dropped.
 */

const REMIND_BEFORE_MS = 60 * 60 * 1000;
const KEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_VIEWINGS = 2000;

const store = (state) => state.store("viewings", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;

/** Upcoming (and today's past) viewings, soonest first. */
const upcoming = (state, now = Date.now()) =>
  Object.values(store(state).data.items)
    .filter((v) => v.at > now - KEEP_AFTER_MS)
    .sort((a, b) => a.at - b.at);

function add(state, { lead, listing, at, chat, by }, now = Date.now()) {
  if (!leads.get(state, lead)) throw new UserError(`There is no client #${lead}.`);
  if (!re.get(state, listing)) throw new UserError(`There is no listing #${listing}.`);
  if (at < now) throw new UserError("That time has already passed.");
  return store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_VIEWINGS) throw new UserError("Too many viewings saved.");
    const id = ++d.seq;
    d.items[id] = { id, lead, listing, at, chat, by };
    return d.items[id];
  });
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

/** Reminds the agent an hour before each viewing; drops old ones. */
async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const v of Object.values(s.data.items)) {
    if (v.at < now - KEEP_AFTER_MS) {
      s.update((d) => delete d.items[v.id]);
      continue;
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

module.exports = { add, remove, get, upcoming, line, confirmation, runDue, startViewingsLoop, when, REMIND_BEFORE_MS };
