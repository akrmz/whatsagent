"use strict";

const re = require("./realestate");
const leads = require("./leads");

/**
 * The reports by unit type (.restats, .deals, the weekly summary): apartments, chalets and villas
 * sell to different buyers at different times, so each is counted on its own.
 */

const UNKNOWN = "غير محدد";
const CLOSED = new Set(["won", "lost"]);

/** A deal's unit type: saved on it (since 3.62), else its listing's, else what the client wanted. */
const dealType = (state, { deal, lead }) => deal.type || (deal.listing && re.get(state, deal.listing)?.type) || lead?.type || UNKNOWN;

/** [{ type, count, value, commission }] for a list of { deal, lead }, the most deals first. */
function deals(state, list) {
  const m = new Map();
  for (const x of list) {
    const t = dealType(state, x);
    const e = m.get(t) || { type: t, count: 0, value: 0, commission: 0 };
    e.count++;
    e.value += x.deal.price || 0;
    e.commission += x.deal.commission || 0;
    m.set(t, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.value - a.value);
}

/**
 * The catalogue and the demand by type: [{ type, available, reserved, gone, views, inquiries,
 * clients (active ones wanting it), deals }], the biggest first.
 */
function catalogue(state) {
  const m = new Map();
  const row = (t) => {
    const k = t || UNKNOWN;
    if (!m.has(k)) m.set(k, { type: k, available: 0, reserved: 0, gone: 0, views: 0, inquiries: 0, clients: 0, deals: 0 });
    return m.get(k);
  };
  for (const l of re.all(state)) {
    const r = row(l.type);
    if (l.status === "available") r.available++;
    else if (l.status === "reserved") r.reserved++;
    else r.gone++;
    r.views += l.stats?.views || 0;
    r.inquiries += l.stats?.inquiries || 0;
  }
  for (const lead of leads.all(state)) {
    if (lead.type && !CLOSED.has(lead.status)) row(lead.type).clients++;
    for (const deal of lead.deals || []) row(dealType(state, { deal, lead })).deals++;
  }
  const size = (r) => r.available + r.reserved + r.gone + r.clients;
  return [...m.values()].filter((r) => size(r) || r.deals).sort((a, b) => size(b) - size(a) || a.type.localeCompare(b.type));
}

module.exports = { dealType, deals, catalogue, UNKNOWN };
