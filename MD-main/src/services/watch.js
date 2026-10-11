"use strict";

const re = require("./realestate");
const leads = require("./leads");
const rotation = require("./rotation");
const { LRU } = require("../core/lru");
const { limiterFor } = require("../core/ratelimit");

/**
 * "نبهني 12": a client asks to be told when a unit's price drops, or when one that is reserved or
 * sold is available again. They are saved (lead.watching, at most 10 units), and the price-drop
 * and back-on-the-market campaigns (.blast 12 drop / back) include them even outside their
 * budget: they asked about this very unit. "نبهني" alone means the unit they last opened (a day).
 * "الغاء التنبيه 12" takes it off. Strangers can send it, so it is limited (5 in 10 minutes per
 * client, new clients shared with "#12" questions) and what is stored is bounded.
 */

const MAX_WATCHING = 10;
const SEEN_FOR = 24 * 3600 * 1000;
const WATCH = /^(?:نبهني|نبّهني|بلغني|بلّغني|عرفني|عرّفني|notify me|alert me|let me know)(?:\s+(?:لو|على|عن|بـ?)?\s*#?\s?(\d{1,5}))?\s*[.!؟?]*$/iu;
const UNWATCH = /^(?:الغاء|إلغاء|وقف|اوقف|أوقف|stop)\s+(?:ال)?(?:تنبيه|تنبيهات|alerts?)(?:\s+#?\s?(\d{1,5}))?\s*[.!؟?]*$/iu;

// The unit each client last opened (for "نبهني" without a number). Memory only, bounded.
const seen = new LRU({ max: 5000, ttlMs: SEEN_FOR });
const noteSeen = (who, id) => seen.set(who, id);

const tooMany = (state, key) => !limiterFor(state, "watch-client", { max: 5, windowMs: 10 * 60 * 1000 })(key);
const newClients = (state) => limiterFor(state, "inquiry-new", { max: 30, windowMs: 3600 * 1000, size: 1 })("all");
const notifyOwner = (state, key) => limiterFor(state, "watch-notify", { max: 1, windowMs: 3600 * 1000 })(key);

/** "نبهني 12" → { watch: true, id: 12 }, "الغاء التنبيه" → { watch: false }, else null. */
function wordOf(text) {
  // A short phrase from anyone: squeezed and length-capped before the patterns (B-25).
  const t = re.latinDigits(re.squeeze(text).trim());
  if (t.length > 60) return null;
  let m = t.match(WATCH);
  if (m) return { watch: true, id: m[1] ? Number(m[1]) : null };
  m = t.match(UNWATCH);
  if (m) return { watch: false, id: m[1] ? Number(m[1]) : null };
  return null;
}

/** Clients asking to be told about this unit (not those who said وقف). */
const watchers = (state, listingId) => leads.all(state).filter((l) => (l.watching || []).includes(listingId) && !l.optedOut && !["won", "lost"].includes(l.status));

/** The line on a client's card ("ابعت نبهني 12"). */
const hint = (l, lang = "ar") =>
  l.status === "available"
    ? lang === "en"
      ? `\n\n🔔 To hear if its price drops, send: notify me ${l.id}`
      : `\n\n🔔 عايز نبلغك لو السعر نزل؟ ابعت: نبهني ${l.id}`
    : lang === "en"
      ? `\n\n🔔 To hear when it's available again, send: notify me ${l.id}`
      : `\n\n🔔 نبلغك لو رجعت متاحة؟ ابعت: نبهني ${l.id}`;

/** A client's "نبهني …" / "الغاء التنبيه …" in a private chat. @returns {Promise<boolean>} handled */
async function handle(ctx) {
  const w = wordOf(ctx.body);
  if (!w) return false;
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  if (!phone) return false;
  if (tooMany(ctx.state, phone)) return true; // a flood: silence
  let lead = leads.byPhone(ctx.state, phone);

  if (!w.watch) {
    if (!lead?.watching?.length) {
      await ctx.reply("مفيش تنبيهات عندك دلوقتي.");
      return true;
    }
    const left = w.id ? lead.watching.filter((id) => id !== w.id) : [];
    leads.update(ctx.state, lead.id, { watching: left.length ? left : undefined });
    await ctx.reply(w.id ? `✅ تمام، مش هنبلغك عن #${w.id}.` : "✅ تمام، اتلغت كل التنبيهات.");
    return true;
  }

  const id = w.id || seen.get(ctx.sender);
  const listing = id && re.get(ctx.state, id);
  if (!listing) {
    await ctx.reply("ابعت رقم الوحدة اللي عايز نبلغك عنها، مثلاً: نبهني 12");
    return true;
  }
  if (!lead) {
    if (!newClients(ctx.state)) return true; // many new numbers in an hour: not saved now
    lead = leads.add(ctx.state, { name: (ctx.senderName || "").slice(0, 60) || undefined, phone, ...(listing.type ? { type: listing.type } : {}), ...(listing.deal ? { deal: listing.deal } : {}), source: "واتساب" }, ctx.sender);
    if (rotation.assignNext(ctx.app, lead.id)) lead = leads.get(ctx.state, lead.id);
  }
  const already = (lead.watching || []).includes(listing.id);
  if (!already) {
    leads.update(ctx.state, lead.id, { watching: [...(lead.watching || []), listing.id].slice(-MAX_WATCHING) });
    leads.note(ctx.state, lead.id, ctx.sender, `طلب التنبيه للعقار #${listing.id} (${listing.status === "available" ? "لو السعر نزل" : "لو رجع متاح"})`);
  }
  const what = listing.status === "available" ? `لو سعر #${listing.id} نزل` : `لو #${listing.id} رجعت متاحة`;
  await ctx.reply(`🔔 تمام، هنبلغك ${what}.\nلإلغاء التنبيه: الغاء التنبيه ${listing.id}`);
  if (!already && notifyOwner(ctx.state, String(lead.id))) {
    await ctx.sock
      .sendMessage(rotation.notifyJid(ctx.app, lead), { text: `🔔 ${lead.name || "عميل"} (+${phone}) طلب يتبلغ ${what} — عميل مهتم بالوحدة دي.\n${ctx.prefix}lead ${lead.id} · ${ctx.prefix}listing who ${listing.id}` })
      .catch(() => {});
  }
  return true;
}

module.exports = { handle, wordOf, watchers, hint, noteSeen, MAX_WATCHING };
