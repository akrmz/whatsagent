"use strict";

const re = require("./realestate");
const { reportsOff } = require("./ownerreport");

/**
 * Asking listings' owners whether a property is still available (.listing ask), and reading
 * their answer. The owner (listing.owner = { name?, phone? }) is private: never on cards
 * clients see. An ask stays open 7 days:
 *   listing.ask = { at, chat, by, answered?: { at, kind, text } }
 */

const OPEN_FOR = 7 * 24 * 3600 * 1000;
const MAX_AT_ONCE = 5;

const AVAILABLE = /^(?:متاح|متاحة|متاحه|لسه متاح|لسه متاحة|لسه|ايوه|أيوه|ايوة|أيوة|ايوا|نعم|اه|آه|ايه|أيه|موجود|موجودة|موجوده|yes|yeah|available|still available)(?![\p{L}])/iu;
const SOLD_WORDS = "اتباع|اتباعت|اتبعت|تم البيع|مباع|مباعة|مباعه|بيعت|بعته|بعناه|sold";
const RENTED_WORDS = "اتأجر|اتأجرت|اتاجر|اتاجرت|تم التأجير|تم التاجير|مؤجر|مؤجرة|مؤجره|أجرته|rented";
const RESERVED_WORDS = "اتحجز|اتحجزت|محجوز|محجوزة|محجوزه|عربون|reserved";
const word = (words) => new RegExp(String.raw`(?<![\p{L}])(?:${words})(?![\p{L}])`, "iu");
const SOLD = word(SOLD_WORDS);
const RENTED = word(RENTED_WORDS);
const RESERVED = word(RESERVED_WORDS);
// "مش متاح", "مبقاش موجود", or a bare "لأ" to "is it still available?": gone, without saying how.
const GONE = word("مش متاح|مش متاحة|مش متاحه|مبقاش متاح|مبقتش متاحة|مش موجود|مش موجودة|مش موجوده|مبقاش موجود|لم يعد متاح|لم تعد متاحة|اتشال|اتشالت|not available|no longer available");
const NO = /^(?:لا|لأ|لاء|لاا|no|nope)[\s.!؟?]*$/iu;
// A no to sold, rented or reserved is a yes to available: "مش اتباع", "ما اتباعش", "لسه ما اتأجرتش",
// "مش محجوزة", "لم يتم البيع". Taken out before the words are looked for.
const NEGATED = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:مش|ما|لم|مو|not)\s?(?:${SOLD_WORDS}|${RENTED_WORDS}|${RESERVED_WORDS})(?:ت?ش)?|(?:${SOLD_WORDS}|${RENTED_WORDS}|${RESERVED_WORDS})ت?ش|لم يتم البيع|لم يتم التأجير|لم يبع|متباعش|ماتباعش)(?![\p{L}])`,
  "giu",
);
const PRICE = /(?<![\p{L}])(?:السعر|سعره|سعرها|بقى|بقت|بقا|نزل|نزلت|زاد|زادت|بـ|price)(?![\p{L}])/iu;

/**
 * What the owner said: available, sold, rented, reserved, unavailable (gone, without saying
 * how), a new price, or something else. A negated "sold" ("مش اتباع") counts as available.
 */
function classify(text) {
  const t = re.latinDigits(re.squeeze(String(text || "")).slice(0, 300)).replace(/#\s?\d{1,5}/g, " "); // "#2" names a listing, it isn't a price
  const rest = t.replace(NEGATED, " ");
  const negated = rest !== t;
  if (SOLD.test(rest)) return { kind: "sold" };
  if (RENTED.test(rest)) return { kind: "rented" };
  if (RESERVED.test(rest)) return { kind: "reserved" };
  if (GONE.test(rest) || NO.test(rest.trim())) return { kind: "unavailable" };
  const amount = rest.match(/\d[\d,.]*\s*(?:مليون|ملايين|million|ألف|الف|k|m)?/iu);
  const price = amount && PRICE.test(rest) ? re.parseAmount(amount[0]) : null;
  if (price && price >= 1000) return { kind: "price", price };
  if (AVAILABLE.test(rest.trim()) || negated) return { kind: "available" };
  return { kind: "other" };
}

/**
 * Who to ask about a listing: its owner, else the broker it came from (a channel or a forwarded
 * post: listing.source, 3.66). @returns {{ phone, name?, kind: "owner"|"broker" } | null}
 */
function contactOf(l) {
  if (l.owner?.phone) return { phone: l.owner.phone, name: l.owner.name, kind: "owner" };
  const p = l.source?.phones?.[0];
  return p ? { phone: p, kind: "broker" } : null;
}

/** The message the owner (or the broker) gets. */
function askText(state, l) {
  const a = re.agent(state);
  const cur = a.currency;
  const c = contactOf(l);
  const what = `${l.type || "العقار"}${l.location ? ` في ${l.location}` : ""}${l.price ? ` المعروض بـ ${re.money(l.price, cur)}${l.deal === "إيجار" ? " شهرياً" : ""}` : ""}`;
  return [
    `${c?.kind === "owner" && l.owner?.name ? `أهلاً ${l.owner.name} 👋` : "أهلاً 👋"}`,
    c?.kind === "broker" ? `بخصوص ${what} اللي كان معروض عندك (#${l.id}): لسه متاح؟` : `بخصوص ${what} (#${l.id}): هل ما زال متاحاً؟`,
    "",
    "رد بكلمة: *متاح* · *اتباع* · *اتأجر* · *اتحجز* · أو السعر الجديد (مثلاً: السعر بقى 3 مليون)",
    re.contactLine(a) ? `\n${re.contactLine(a)}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** Sends the question to the owner and opens the ask; the answer goes to `chat`. */
async function deliver({ sock, state }, l, { chat, by, auto = false }, now = Date.now()) {
  const c = contactOf(l);
  if (!c) throw new Error(`#${l.id} has no owner or broker number`);
  await sock.sendMessage(`${c.phone}@s.whatsapp.net`, { text: askText(state, l) });
  re.update(state, l.id, { ask: { at: now, chat, by, to: c.phone, kind: c.kind, ...(auto ? { auto: true } : {}) } }, l.updated); // asking isn't an update
}

/** ".listing ask": the answer comes back to the chat it was asked from. */
const ask = (ctx, l, now = Date.now()) => deliver(ctx, l, { chat: ctx.chatId, by: ctx.sender }, now);

/** Questions sent 3 to 10 days ago with no answer yet, about listings still shown as available: worth a call. */
const unanswered = (state, now = Date.now()) =>
  re
    .all(state)
    .filter((l) => l.status === "available" && l.ask && !l.ask.answered && now - l.ask.at >= 3 * 86400000 && now - l.ask.at <= 10 * 86400000)
    .sort((a, b) => a.ask.at - b.ask.at);

// ---- asked by themselves (.agent autoask on) ----------------------------------------------

const DAY = 24 * 3600 * 1000;
const STALE_AFTER = 30 * DAY; // not updated (or confirmed) for 30 days
const ASK_EVERY = 30 * DAY; // and not asked about in the last 30 days
const AUTO_PER_DAY = 5;

/** The listing still needs asking about: available, someone to ask, quiet for 30 days, not asked lately. */
const autoDue = (state, l, now = Date.now()) =>
  l.status === "available" && Boolean(contactOf(l)) && now - (l.updated || l.created || 0) >= STALE_AFTER && !(l.ask && now - l.ask.at < ASK_EVERY);

/**
 * Today's automatic questions: the listings longest without news first, one per number (a
 * second question to the same person would make "متاح" ambiguous), none to a number with a
 * question still open or that asked for no more messages (وقف التقارير), at most 5.
 */
function autoTargets(state, now = Date.now()) {
  const seen = new Set();
  return re
    .all(state)
    .filter((l) => autoDue(state, l, now))
    .sort((a, b) => (a.updated || a.created || 0) - (b.updated || b.created || 0) || a.id - b.id)
    .filter((l) => {
      const phone = contactOf(l).phone;
      if (seen.has(phone) || reportsOff(state, phone) || openAsks(state, phone, now).length) return false;
      seen.add(phone);
      return true;
    })
    .slice(0, AUTO_PER_DAY);
}

/** Listings with a question still open to this number (the one it was sent to), newest first. */
const openAsks = (state, phone, now = Date.now()) =>
  re
    .all(state)
    .filter((l) => l.ask && !l.ask.answered && now - l.ask.at < OPEN_FOR && (l.ask.to ? l.ask.to === phone : l.owner?.phone === phone))
    .sort((a, b) => b.ask.at - a.ask.at);

/**
 * An owner's private message. With one open question (or "#12" in the reply), the answer is
 * recorded; "available" confirms the listing (it counts as freshly updated). The agent is told
 * in the chat where they asked. @returns {boolean} true if it was an answer
 */
async function handleReply(ctx, phone, now = Date.now()) {
  const open = openAsks(ctx.state, phone, now);
  if (!open.length) return false;
  const named = re.latinDigits(ctx.body).match(/#\s?(\d{1,5})/);
  const l = named ? open.find((x) => x.id === Number(named[1])) : open.length === 1 ? open[0] : null;
  const cur = re.agent(ctx.state).currency;
  const who = open[0].ask.kind === "broker" ? `السمسار (+${phone})` : `${open[0].owner?.name || "المالك"} (+${phone})`;
  const text = ctx.body.trim().slice(0, 300);
  const tell = (chat, msg) => ctx.sock.sendMessage(chat || `${ctx.config.owners.numbers[0]}@s.whatsapp.net`, { text: msg }).catch(() => {});

  if (!l) {
    // Several questions open and the reply doesn't say which: pass it on as it is.
    await tell(open[0].ask.chat, `💬 رد ${who} على سؤال الإتاحة (${open.map((x) => `#${x.id}`).join("، ")}):\n"${text}"`);
    await ctx.reply(`شكراً لك 🙏 لو الرد عن وحدة معينة اكتب رقمها، مثلاً: #${open[0].id} متاح`);
    return true;
  }
  const answer = classify(text);
  re.update(ctx.state, l.id, { ask: { ...l.ask, answered: { at: now, kind: answer.kind, text } } }, answer.kind === "available" ? now : l.updated);
  const head = `#${l.id} ${l.type || "عقار"}${l.location ? ` — ${l.location}` : ""}`;
  const msg = {
    available: `✅ ${who} أكد إن ${head} لسه متاح (اتحدّث تاريخه).`,
    sold: `🔴 ${who} قال إن ${head} اتباع.\n${ctx.prefix}listing status ${l.id} sold`,
    rented: `🔴 ${who} قال إن ${head} اتأجر.\n${ctx.prefix}listing status ${l.id} rented`,
    reserved: `⏳ ${who} قال إن ${head} اتحجز:\n"${text}"\n${ctx.prefix}listing status ${l.id} reserved`,
    unavailable: `🔴 ${who} قال إن ${head} مبقاش متاح (من غير ما يقول اتباع ولا اتأجر):\n"${text}"\n${ctx.prefix}listing status ${l.id} ${l.deal === "إيجار" ? "rented" : "sold"} · أو لو اتحجز: ${ctx.prefix}listing status ${l.id} reserved`,
    price: `💰 ${who}: السعر الجديد لـ ${head} ${re.money(answer.price || 0, cur)}${l.price ? ` (كان ${re.money(l.price, cur)})` : ""}.\n${ctx.prefix}listing edit ${l.id} السعر: ${re.shortAr(answer.price || 0)}`,
    other: `💬 رد ${who} عن ${head}:\n"${text}"`,
  }[answer.kind];
  await tell(l.ask.chat, msg);
  await ctx.reply("شكراً لك 🙏");
  return true;
}

module.exports = { classify, askText, ask, deliver, autoDue, autoTargets, unanswered, openAsks, handleReply, contactOf, OPEN_FOR, MAX_AT_ONCE, STALE_AFTER, AUTO_PER_DAY };
