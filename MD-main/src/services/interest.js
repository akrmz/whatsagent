"use strict";

const leads = require("./leads");

/**
 * Who is interested in a listing (.listing who 12): every client whose history shows a viewing
 * (and how it went), a question about it, or that it was sent to them — the strongest sign
 * first. Read from what the bot already notes on clients, plus their sent listings (kept even
 * when old notes are trimmed).
 */

const DAY = 86400000;
// The signs, strongest first. `re` finds the listing number in a client's history note.
const SIGNS = [
  { key: "liked", label: "👍 أعجبه في المعاينة", score: 6, re: /^نتيجة معاينة #(\d+): 👍/u },
  { key: "thinking", label: "🤔 بيفكر بعد المعاينة", score: 5, re: /^نتيجة معاينة #(\d+): 🤔/u },
  { key: "viewing", label: "🗓️ حجز معاينة", score: 4, re: /^(?:موعد معاينة|حجز معاينة) #(\d+)/u },
  { key: "asked", label: "💬 سأل عنه", score: 3, re: /^سأل عن العقار #(\d+)/u },
  { key: "sent", label: "📤 اتبعت له", score: 2, re: /^(?:أُرسل له (?:تخفيض سعر )?العقار|أُرسل له عرض سعر للعقار|إعادة تواصل: أُرسل له العقار) #(\d+)/u },
  { key: "noshow", label: "🚫 ما حضرش المعاينة", score: 1, re: /^نتيجة معاينة #(\d+): 🚫/u },
  { key: "no", label: "👎 ما عجبهوش", score: 0, re: /^نتيجة معاينة #(\d+): 👎/u },
];
const CLOSED = new Set(["won", "lost"]);

/** One client's strongest sign for a listing: { key, label, score, at } or null. */
function signOf(lead, listingId) {
  let best = null;
  const consider = (sign, at) => {
    if (!best || sign.score > best.score || (sign.score === best.score && at > best.at)) best = { ...sign, at };
  };
  for (const h of lead.history || []) {
    for (const sign of SIGNS) {
      const m = String(h.text || "").match(sign.re);
      if (m && Number(m[1]) === listingId) consider(sign, h.at || 0);
    }
  }
  // Sent but the note is gone (histories keep the last 50): still a sign.
  if (!best && (lead.sentListings || []).includes(listingId)) consider(SIGNS.find((s) => s.key === "sent"), lead.lastSentListing === listingId ? lead.lastSentAt || 0 : 0);
  return best;
}

/** Clients with a sign for this listing: active ones first, then by strength and recency. */
function forListing(state, listingId) {
  return leads
    .all(state)
    .map((lead) => ({ lead, sign: signOf(lead, listingId) }))
    .filter((x) => x.sign)
    .sort((a, b) => Number(CLOSED.has(a.lead.status)) - Number(CLOSED.has(b.lead.status)) || b.sign.score - a.sign.score || b.sign.at - a.sign.at);
}

const ago = (at, now = Date.now()) => {
  if (!at) return "";
  const d = Math.floor((now - at) / DAY);
  return d < 1 ? "النهارده" : d === 1 ? "امبارح" : `من ${d} يوم`;
};

module.exports = { forListing, signOf, ago, SIGNS };
