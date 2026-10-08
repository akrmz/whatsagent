"use strict";

const crypto = require("node:crypto");
const re = require("./realestate");
const leads = require("./leads");
const requests = require("./requests");
const { limiterFor } = require("../core/ratelimit");

/**
 * Broker groups (.watch on): other brokers' posts in a watched group are read as offers
 * ("شقة للبيع … بسعر") or requests ("مطلوب شقة …"). Offers go into a searchable feed (.feed);
 * the agent is told when an offer suits saved clients, or a request matches own listings.
 *   DATA_DIR/feed.json { seq, groups: { [chat]: { name, by, since } }, items: { [id]: item } }
 *   item: { id, kind: "offer"|"request", chat, poster (number or ""), name, text, fields, hash, at }
 */

const MAX_ITEMS = 2000;
const KEEP_DAYS = 30;
const REPOST_DAYS = 7; // the same post again within a week is a repost
const DAY = 86400 * 1000;

const store = (state) => state.store("feed", { seq: 0, groups: {}, items: {} });
const watched = (state, chat) => store(state).data.groups[chat] || null;
const groups = (state) => store(state).data.groups;
const get = (state, id) => store(state).data.items[id] || null;
const all = (state, kind) =>
  Object.values(store(state).data.items)
    .filter((i) => !kind || i.kind === kind)
    .sort((a, b) => b.id - a.id);

function watch(state, chat, name, by) {
  store(state).update((d) => (d.groups[chat] = { name: String(name || "").slice(0, 60), by, since: Date.now() }));
}
function unwatch(state, chat) {
  store(state).update((d) => delete d.groups[chat]);
}

/** Same post (spaces, emoji and punctuation aside) → same hash. */
const hashOf = (text) =>
  crypto
    .createHash("sha256")
    .update(re.latinDigits(String(text)).replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);

/**
 * What a broker's post is: a request (someone looking), an offer (a property with a price and
 * an area or size), or nothing. @returns {{ kind, fields } | null}
 */
function classify(text) {
  const t = String(text || "").trim();
  if (t.length < 15 || t.length > 2000) return null;
  const wish = requests.detect(t.length <= 300 ? t : "");
  if (wish) return { kind: "request", fields: wish };
  const f = re.parseListingText(t);
  if (f.type && f.price && (f.location || f.size)) {
    const { notes: _notes, ...fields } = f;
    return { kind: "offer", fields };
  }
  return null;
}

/**
 * Saves a post (unless it's a recent repost) and prunes old ones.
 * @returns {object | null} the new item, or null for a repost
 */
function save(state, { kind, fields, chat, poster, name, text }, now = Date.now()) {
  const hash = hashOf(text);
  return store(state).update((d) => {
    const dup = Object.values(d.items).find((i) => i.hash === hash && now - i.at < REPOST_DAYS * DAY);
    if (dup) return null;
    for (const i of Object.values(d.items)) if (now - i.at > KEEP_DAYS * DAY) delete d.items[i.id];
    const ids = Object.keys(d.items).map(Number).sort((a, b) => a - b);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_ITEMS + 1))) delete d.items[old];
    const id = ++d.seq;
    d.items[id] = { id, kind, chat, poster: poster || "", name: String(name || "").slice(0, 60), text: String(text).slice(0, 1000), fields, hash, at: now };
    return d.items[id];
  });
}

/** An offer as a listing-like object (for matching and display). */
const asListing = (item) => ({ id: `F${item.id}`, status: "available", deal: "بيع", ...item.fields });

/** Which of the agent's clients an offer suits, or which own listings a request matches. */
function matchesFor(state, item) {
  if (item.kind === "offer") return leads.matchingLeads(state, asListing(item)).map(({ lead, fit }) => ({ lead, over: fit.over }));
  return leads.matchingListings(state, item.fields).map(({ listing, fit }) => ({ listing, over: fit.over }));
}

// At most 20 match alerts an hour in all (a busy group must not flood the agent).
const alertBudget = (state) => limiterFor(state, "feed-alerts", { max: 20, windowMs: 3600 * 1000, size: 1 })("all");

/** The alert the agent gets, or null when nothing matches. */
function alertText(state, item, prefix) {
  const m = matchesFor(state, item);
  if (!m.length) return null;
  const cur = re.agent(state).currency;
  const group = watched(state, item.chat)?.name || "جروب";
  const who = item.poster ? `+${item.poster}` : "—";
  if (item.kind === "offer") {
    const names = m.slice(0, 5).map(({ lead }) => `#${lead.id} ${lead.name || ""}`.trim()).join("، ");
    return `🔔 عرض في "${group}" يناسب ${m.length} من عملائك: ${names}${m.length > 5 ? " …" : ""}\n${re.line(asListing(item), cur)}\n👤 السمسار: ${item.name || ""} ${who}\n${prefix}feed ${item.id}`;
  }
  const ids = m.slice(0, 5).map(({ listing }) => `#${listing.id}`).join("، ");
  return `🔔 طلب في "${group}": ${requests.describe(item.fields, cur)}\n🏠 عندك ${m.length} مناسب: ${ids}${m.length > 5 ? " …" : ""}\n👤 السمسار: ${item.name || ""} ${who}\n${prefix}feed ${item.id}`;
}

module.exports = { watch, unwatch, watched, groups, get, all, classify, save, hashOf, asListing, matchesFor, alertText, alertBudget, KEEP_DAYS, REPOST_DAYS, MAX_ITEMS };
