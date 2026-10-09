"use strict";

const re = require("./realestate");
const leads = require("./leads");
const rotation = require("./rotation");
const viewings = require("./viewings");
const catalog = require("./catalogmenu");
const { zoneNow } = require("./gcschedule");
const { parseClock } = require("./reminders");
const { zonedInstant, localDate } = require("./timecalc");
const { limiterFor } = require("../core/ratelimit");
const { UserError } = require("../core/errors");

/**
 * Clients book a viewing themselves (.agent booking on): in a private chat they send "معاينة"
 * (or "معاينة 12"), get the next free times within the agent's viewing hours, and reply with a
 * number. The viewing is booked like ".viewing add … send": the client gets a confirmation and
 * a reminder 2 hours before, the agent (or the client's assigned team member) a reminder an hour
 * before, and is told at once. "الغاء المعاينة" cancels it. Times already booked are never
 * offered twice.
 *   DATA_DIR/booking.json { settings: { from, to, days, length }, day: { date, count } }
 * Offered times and the listing a client last opened are kept in memory only.
 */

const DEFAULTS = { from: "11:00", to: "19:00", days: [6, 0, 1, 2, 3, 4], length: 60 }; // Saturday to Thursday
const DAY_NAMES = [
  ["sun", "sunday", "الأحد", "الاحد", "حد"],
  ["mon", "monday", "الاثنين", "الإثنين", "اتنين", "الاتنين"],
  ["tue", "tuesday", "الثلاثاء", "التلات", "تلات"],
  ["wed", "wednesday", "الأربعاء", "الاربعاء", "اربع", "الاربع"],
  ["thu", "thursday", "الخميس", "خميس"],
  ["fri", "friday", "الجمعة", "الجمعه", "جمعة"],
  ["sat", "saturday", "السبت", "سبت"],
];
const OFFER = 6; // times offered at once
const AHEAD_DAYS = 7;
const MIN_NOTICE = 2 * 3600 * 1000; // the earliest time offered is 2 hours away
const OPEN_FOR = 10 * 60 * 1000;
const MAX_UPCOMING = 2; // per client
const MAX_PER_DAY = 20; // self-bookings a day, all clients
const VIEWED_FOR = 24 * 3600 * 1000;
const DIGITS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

const TRIGGER = /^(?:(?:عايز|عاوز|عايزة|عاوزة|ممكن|اريد|أريد|محتاج)\s+)?(?:(?:احجز|أحجز|حجز|اعمل)\s+)?(?:معاينة|معاينه|موعد معاينة|معاد معاينة|ميعاد معاينة|موعد معاينه|معاد معاينه|ميعاد معاينه)(?:\s+(?:لل?عقار\s*)?#?\s*(\d{1,5}))?$/;
const CANCEL = /^(?:الغاء|إلغاء|الغي|ألغي|الغى|cancel)\s+(?:ال)?(?:معاينة|معاينه|معاد|موعد|ميعاد)$/i;

const store = (state) => state.store("booking", { settings: {}, day: { date: "", count: 0 } });
const settings = (state) => ({ ...DEFAULTS, ...store(state).data.settings });

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function setHours(state, text) {
  const m = String(text || "").match(/^(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)$/);
  const [from, to] = m ? [parseClock(m[1]), parseClock(m[2])] : [null, null];
  if (from === null || to === null || from >= to) throw new UserError("Viewing hours like 11:00-19:00 (start before end, same day).");
  store(state).update((d) => Object.assign(d.settings, { from: hhmm(from), to: hhmm(to) }));
}

/** "sat sun mon tue wed thu", "السبت الأحد …" or "sat-thu" (a range wraps round the week). */
function setDays(state, text) {
  const dayOf = (w) => DAY_NAMES.findIndex((names) => names.includes(w.toLowerCase()));
  const t = String(text || "").trim();
  const range = t.match(/^(\S+)\s*-\s*(\S+)$/);
  let days;
  if (range) {
    const [a, b] = [dayOf(range[1]), dayOf(range[2])];
    if (a < 0 || b < 0) throw new UserError("Days like sat-thu, or a list: sat sun mon tue wed thu (السبت الأحد …)");
    days = [];
    for (let d = a; ; d = (d + 1) % 7) {
      days.push(d);
      if (d === b) break;
    }
  } else {
    days = [...new Set(t.split(/[\s,،]+/).filter(Boolean).map(dayOf))];
    if (!days.length || days.includes(-1)) throw new UserError("Days like sat-thu, or a list: sat sun mon tue wed thu (السبت الأحد …)");
  }
  store(state).update((d) => (d.settings.days = days));
}

function setLength(state, minutes) {
  if (!(Number.isInteger(minutes) && minutes >= 30 && minutes <= 180)) throw new UserError("A viewing takes 30 to 180 minutes (60 is the default).");
  store(state).update((d) => (d.settings.length = minutes));
}

const DAY_SHORT = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const describe = (s) => `${s.days.length === 7 ? "كل يوم" : s.days.map((d) => DAY_SHORT[d]).join("، ")} · ${s.from}–${s.to} · ${s.length} دقيقة للمعاينة`;

/**
 * The next free start times within the viewing hours: not sooner than 2 hours from now, at most
 * 7 days ahead, and not overlapping a viewing already booked (the agent can't be in two places).
 */
function freeSlots(state, timeZone, now = Date.now(), count = OFFER) {
  const s = settings(state);
  const len = s.length * 60000;
  const [from, to] = [parseClock(s.from), parseClock(s.to)];
  const booked = viewings.upcoming(state, now).map((v) => v.at);
  const slots = [];
  const today = localDate(timeZone, now);
  for (let i = 0; i <= AHEAD_DAYS && slots.length < count; i++) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!s.days.includes(date.getUTCDay())) continue;
    const ymd = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    for (let min = from; min + s.length <= to && slots.length < count; min += s.length) {
      const at = zonedInstant(timeZone, ymd, min);
      if (at < now + MIN_NOTICE) continue;
      if (booked.some((b) => Math.abs(b - at) < len)) continue;
      slots.push(at);
    }
  }
  return slots;
}

/**
 * When the office opens next (the viewing days and hours stand for the agent's working
 * hours), or null if it is open now. Used to tell a client who asks for a person when to expect a call.
 */
function nextOpen(state, timeZone, now = Date.now()) {
  const s = settings(state);
  const [from, to] = [parseClock(s.from), parseClock(s.to)];
  const today = localDate(timeZone, now);
  const { minutes } = zoneNow(timeZone, now);
  for (let i = 0; i <= 7; i++) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    if (!s.days.includes(date.getUTCDay())) continue;
    if (i === 0 && minutes >= from && minutes < to) return null; // open now
    if (i === 0 && minutes >= to) continue; // closed for today
    return zonedInstant(timeZone, { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }, from);
  }
  return null;
}

// ---- in memory: offered times, and the listing each client last opened ---------------------

const memory = new WeakMap();
function mem(state) {
  let m = memory.get(state);
  if (!m) memory.set(state, (m = { offers: new Map(), viewed: new Map() }));
  return m;
}
const keep = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > 2000) map.delete(map.keys().next().value);
};

/** A client opened a listing ("#12", the menu): a later plain "معاينة" means that one. */
function noteViewed(state, who, listingId, now = Date.now()) {
  keep(mem(state).viewed, who, { id: listingId, at: now });
}

/** Which listing "معاينة" means: the number given, else the one they last opened (a day), else the last one sent to them. */
function listingFor(state, who, lead, named, now) {
  if (named) return re.get(state, named);
  const seen = mem(state).viewed.get(who);
  const sent = lead?.lastSentListing ? { id: lead.lastSentListing, at: lead.lastSentAt || 0 } : null;
  const recent = seen && now - seen.at < VIEWED_FOR ? seen : null;
  const pick = [recent, sent].filter(Boolean).sort((a, b) => b.at - a.at)[0];
  return pick ? re.get(state, pick.id) : null;
}

const when = (t, timeZone) => viewings.when(t, timeZone);
const agentOf = (ctx, lead) => lead?.assignee || `${ctx.config.owners.numbers[0]}@s.whatsapp.net`;
const isSelfBooked = (lead) => (v) => v.self && v.lead === lead.id;

function phoneOf(ctx) {
  const pn = ctx.app.identity.toPn(ctx.sender);
  return pn ? pn.split("@")[0] : null;
}

/**
 * Offers the client the next free times for a listing (they reply with a number). Also used by
 * the customer assistant when a client asks to see a listing. @returns {Promise<boolean>} offered
 */
async function offerTimes(ctx, listing, now = Date.now()) {
  const tz = ctx.config.bot.timezone;
  const phone = phoneOf(ctx);
  const lead = phone ? leads.byPhone(ctx.state, phone) : null;
  if (listing.status !== "available") {
    await ctx.reply(`للأسف العقار #${listing.id} مش متاح دلوقتي. ابعت *عقارات* تشوف المتاح.`);
    return false;
  }
  const slots = freeSlots(ctx.state, tz, now);
  if (!slots.length) {
    await ctx.reply("مفيش مواعيد فاضية الأيام الجاية، هنتواصل معاك نحدد معاد 🙏");
    await ctx.sock.sendMessage(agentOf(ctx, lead), { text: `📅 ${lead?.name || ctx.senderName || "عميل"}${phone ? ` (+${phone})` : ""} عايز يعاين #${listing.id} ومفيش مواعيد فاضية في مواعيد المعاينة. اتواصل معاه.` }).catch(() => {});
    return false;
  }
  keep(mem(ctx.state).offers, ctx.sender, { listing: listing.id, slots, at: now });
  const what = `${listing.type || "العقار"}${listing.location ? ` في ${listing.location}` : ""} (#${listing.id})`;
  await ctx.reply([`🗓️ *مواعيد المعاينة المتاحة* — ${what}`, "", ...slots.map((t, i) => `${DIGITS[i + 1]} ${when(t, tz)}`), "", "اكتب رقم المعاد اللي يناسبك 👇"].join("\n"));
  return true;
}

/**
 * A client's private message. @returns {Promise<boolean>} true if it was handled
 */
async function handle(ctx, now = Date.now()) {
  const text = re.latinDigits(ctx.body.trim()).replace(/[.!؟?]+$/, "").replace(/\s+/g, " ");
  const who = ctx.sender;
  const m = mem(ctx.state);
  const offer = m.offers.get(who);
  const isOpen = offer && now - offer.at < OPEN_FOR;
  if (catalog.TRIGGER.test(text)) {
    m.offers.delete(who); // the menu takes over the numbers
    return false;
  }
  const trigger = text.match(TRIGGER);
  const cancel = CANCEL.test(text);
  const pick = isOpen && /^\d$/.test(text) ? Number(text) : null;
  if (!trigger && !cancel && pick === null) return false;
  if (!limiterFor(ctx.state, "booking-client", { max: 6, windowMs: 60 * 1000 })(who)) return true; // a flood: silence

  const tz = ctx.config.bot.timezone;
  const phone = phoneOf(ctx);
  const lead = phone ? leads.byPhone(ctx.state, phone) : null;

  if (cancel) {
    const mine = lead ? viewings.upcoming(ctx.state, now).filter((v) => v.at > now).filter(isSelfBooked(lead)) : [];
    if (!mine.length) {
      await ctx.reply("مفيش معاينة محجوزة باسمك حالياً. لحجز معاد ابعت: معاينة");
      return true;
    }
    const v = viewings.remove(ctx.state, mine[0].id);
    const l = re.get(ctx.state, v.listing);
    leads.note(ctx.state, lead.id, "client", `ألغى معاينة #${v.listing} (${when(v.at, tz)})`, now);
    await ctx.reply(`✅ اتلغى معاد المعاينة (${when(v.at, tz)}). لو حابب تحجز معاد تاني ابعت: معاينة${l ? ` ${l.id}` : ""}`);
    await ctx.sock.sendMessage(v.chat, { text: `❌ ${lead.name || "العميل"} (#${lead.id}) ألغى معاينة #${v.listing} يوم ${when(v.at, tz)}.` }).catch(() => {});
    return true;
  }

  if (trigger) {
    const listing = listingFor(ctx.state, who, lead, trigger[1] ? Number(trigger[1]) : null, now);
    if (!listing) {
      await ctx.reply("تحب تعاين أنهي عقار؟ ابعت رقمه، مثلاً: معاينة 12");
      return true;
    }
    await offerTimes(ctx, listing, now);
    return true;
  }

  // A number picks one of the times offered.
  const at = offer.slots[pick - 1];
  if (!at) {
    await ctx.reply(`اختار رقم من 1 لـ ${offer.slots.length}.`);
    return true;
  }
  const listing = re.get(ctx.state, offer.listing);
  if (!listing || listing.status !== "available") {
    m.offers.delete(who);
    await ctx.reply("للأسف العقار ده مبقاش متاح. ابعت *عقارات* تشوف المتاح.");
    return true;
  }
  if (!freeSlots(ctx.state, tz, now, 100).includes(at)) {
    await ctx.reply("المعاد ده اتحجز لسه دلوقتي 🙏 ابعت *معاينة* تاني تشوف المواعيد الفاضية.");
    m.offers.delete(who);
    return true;
  }
  if (lead && viewings.upcoming(ctx.state, now).filter((v) => v.at > now).filter(isSelfBooked(lead)).length >= MAX_UPCOMING) {
    await ctx.reply(`عندك ${MAX_UPCOMING} معاينات محجوزة بالفعل. لإلغاء واحدة ابعت: الغاء المعاينة`);
    return true;
  }
  const s = store(ctx.state);
  const { day } = zoneNow(tz, now);
  if (s.data.day.date === day && s.data.day.count >= MAX_PER_DAY) {
    await ctx.reply("هنتواصل معاك نأكد المعاد 🙏");
    return true;
  }

  let client = lead;
  if (!client) {
    client = leads.add(
      ctx.state,
      {
        name: (ctx.senderName || "").slice(0, 60) || undefined,
        phone: phone || undefined,
        ...(listing.type ? { type: listing.type } : {}),
        ...(listing.deal ? { deal: listing.deal } : {}),
        source: "حجز معاينة",
      },
      ctx.sender,
      now,
    );
    if (rotation.assignNext(ctx.state, client.id, now)) client = leads.get(ctx.state, client.id); // the team member whose turn it is
  }
  const agent = agentOf(ctx, client);
  const v = viewings.add(ctx.state, { lead: client.id, listing: listing.id, at, chat: agent, by: agent, notifyClient: Boolean(client.phone), self: true }, now);
  s.update((d) => (d.day = { date: day, count: (d.day.date === day ? d.day.count : 0) + 1 }));
  if (["new", "contacted"].includes(client.status)) leads.update(ctx.state, client.id, { status: "viewing" }, now);
  leads.note(ctx.state, client.id, "client", `حجز معاينة #${listing.id} بنفسه: ${when(at, tz)}`, now);
  m.offers.delete(who);

  await ctx.reply(`${viewings.confirmation(ctx.state, v, tz)}\n\nلو حصل تغيير ابعت: الغاء المعاينة`);
  await ctx.sock
    .sendMessage(agent, { text: `📅 *حجز معاينة من العميل*${lead ? "" : " (عميل جديد)"}\n${viewings.line(ctx.state, v, tz)}${client.phone ? `\n📞 +${client.phone}` : ""}\n\nإلغاء: ${ctx.prefix}viewing del ${v.id} · العميل: ${ctx.prefix}lead ${client.id}` })
    .catch(() => {});
  return true;
}

module.exports = { handle, offerTimes, nextOpen, freeSlots, settings, setHours, setDays, setLength, describe, noteViewed, TRIGGER, CANCEL, DEFAULTS };
