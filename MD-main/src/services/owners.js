"use strict";

const re = require("./realestate");

/**
 * Asking listings' owners whether a property is still available (.listing ask), and reading
 * their answer. The owner (listing.owner = { name?, phone? }) is private: never on cards
 * clients see. An ask stays open 7 days:
 *   listing.ask = { at, chat, by, answered?: { at, kind, text } }
 */

const OPEN_FOR = 7 * 24 * 3600 * 1000;
const MAX_AT_ONCE = 5;

const AVAILABLE = /^(?:متاح|متاحة|متاحه|لسه متاح|لسه متاحة|لسه|ايوه|أيوه|ايوة|أيوة|ايوا|نعم|اه|آه|ايه|أيه|موجود|موجودة|موجوده|yes|yeah|available|still available)(?![\p{L}])/iu;
const SOLD = /(?<![\p{L}])(?:اتباع|اتباعت|اتبعت|تم البيع|مباع|مباعة|مباعه|بيعت|بعته|بعناه|sold)(?![\p{L}])/iu;
const RENTED = /(?<![\p{L}])(?:اتأجر|اتأجرت|اتاجر|اتاجرت|تم التأجير|تم التاجير|مؤجر|مؤجرة|أجرته|rented)(?![\p{L}])/iu;
const PRICE = /(?<![\p{L}])(?:السعر|سعره|سعرها|بقى|بقت|بقا|نزل|نزلت|زاد|زادت|بـ|price)(?![\p{L}])/iu;

/** What the owner said: available, sold, rented, a new price, or something else. */
function classify(text) {
  const t = re.latinDigits(String(text || "").trim()).replace(/#\s?\d{1,5}/g, " "); // "#2" names a listing, it isn't a price
  if (SOLD.test(t)) return { kind: "sold" };
  if (RENTED.test(t)) return { kind: "rented" };
  const amount = t.match(/\d[\d,.]*\s*(?:مليون|ملايين|million|ألف|الف|k|m)?/iu);
  const price = amount && PRICE.test(t) ? re.parseAmount(amount[0]) : null;
  if (price && price >= 1000) return { kind: "price", price };
  if (AVAILABLE.test(t)) return { kind: "available" };
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
    "رد بكلمة: *متاح* · *اتباع* · *اتأجر* · أو السعر الجديد (مثلاً: السعر بقى 3 مليون)",
    re.contactLine(a) ? `\n${re.contactLine(a)}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** Sends the question to the owner and opens the ask. */
async function ask(ctx, l, now = Date.now()) {
  const c = contactOf(l);
  if (!c) throw new Error(`#${l.id} has no owner or broker number`);
  await ctx.sock.sendMessage(`${c.phone}@s.whatsapp.net`, { text: askText(ctx.state, l) });
  re.update(ctx.state, l.id, { ask: { at: now, chat: ctx.chatId, by: ctx.sender, to: c.phone, kind: c.kind } }, l.updated); // asking isn't an update
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
    price: `💰 ${who}: السعر الجديد لـ ${head} ${re.money(answer.price || 0, cur)}${l.price ? ` (كان ${re.money(l.price, cur)})` : ""}.\n${ctx.prefix}listing edit ${l.id} السعر: ${re.shortAr(answer.price || 0)}`,
    other: `💬 رد ${who} عن ${head}:\n"${text}"`,
  }[answer.kind];
  await tell(l.ask.chat, msg);
  await ctx.reply("شكراً لك 🙏");
  return true;
}

module.exports = { classify, askText, ask, openAsks, handleReply, contactOf, OPEN_FOR, MAX_AT_ONCE };
