"use strict";

const re = require("./realestate");
const leads = require("./leads");
const market = require("./market");
const feed = require("./feed");

/**
 * What clients want that nothing in the catalogue matches (.wanted), as a "مطلوب" post for the
 * brokers' groups the bot watches. The post names no client: the type, sale/rent, area, budget,
 * rooms and must-haves only, and the agent's contact. Brokers who have such a unit answer in the
 * group, where the feed (.watch) already reads offers and tells the agent which clients they suit.
 */

const MAX_LINES = 8;
const POST_EVERY = 24 * 3600 * 1000; // a group gets the post at most once a day
const ACTIVE = (l) => !["won", "lost"].includes(l.status);

/**
 * [{ type, deal, area, max, rooms, features, count }] — active clients with a type and nothing
 * matching, grouped by type, sale/rent and area, the most clients first.
 */
function gaps(state) {
  const groups = new Map();
  for (const lead of leads.all(state).filter((l) => ACTIVE(l) && l.type)) {
    if (leads.matchingListings(state, lead).length) continue;
    const area = market.areaOf(lead.location) || "";
    const key = `${lead.type}|${lead.deal || ""}|${area}`;
    const g = groups.get(key) || { type: lead.type, deal: lead.deal, area, max: 0, rooms: 0, features: new Set(), count: 0 };
    g.count++;
    g.max = Math.max(g.max, lead.max || 0);
    g.rooms = Math.max(g.rooms, lead.rooms || 0);
    for (const f of lead.features || []) g.features.add(f);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, features: [...g.features] })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** "• فيلا للبيع في الشيخ زايد · 4 غرف · صف أول — حتى 15 مليون" */
const line = (g, cur) =>
  `• ${g.type}${g.deal ? ` لل${g.deal}` : ""}${g.area ? ` في ${g.area}` : ""}${g.rooms ? ` · ${g.rooms} غرف` : ""}${g.features.length ? ` · ${g.features.join("، ")}` : ""}${g.max ? ` — حتى ${re.shortAr(g.max)} ${cur}` : ""}`;

/** The post for the brokers' groups. */
function postText(state, list) {
  const a = re.agent(state);
  return ["🔎 *مطلوب لعملاء جاهزين*", "", ...list.slice(0, MAX_LINES).map((g) => line(g, a.currency || "جنيه")), "", "اللي عنده حاجة مناسبة يبعتلي التفاصيل والصور 🙏", re.contactLine(a) || null].filter((x) => x !== null).join("\n");
}

const store = (state) => state.store("wanted", { posted: {} });

/** Watched groups that haven't had the post in the last day. */
const dueGroups = (state, now = Date.now()) => Object.entries(feed.groups(state)).filter(([chat]) => now - (store(state).data.posted[chat] || 0) >= POST_EVERY);
const markPosted = (state, chat, now = Date.now()) => store(state).update((d) => (d.posted[chat] = now));

module.exports = { gaps, line, postText, dueGroups, markPosted, MAX_LINES, POST_EVERY };
