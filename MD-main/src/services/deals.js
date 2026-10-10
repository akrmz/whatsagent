"use strict";

const re = require("./realestate");
const leads = require("./leads");
const team = require("./team");
const { UserError } = require("../core/errors");
const { zoneNow } = require("./gcschedule");

/**
 * Closed deals (.lead won, .deals): kept on the client as lead.deals = [{ listing?, price,
 * commission?, rate?, kind: "بيع"|"إيجار", at }] (a client can buy more than once). Closing a deal marks the
 * client "won" and the listing sold or rented.
 */

/**
 * ".lead won 5 #12 3.1m 2.5%" arguments after the client number: "#12" a listing, an amount
 * the price, "2.5%" the commission rate, "عمولة 80 ألف" a commission amount.
 */
function parseDealArgs(tokens) {
  const t = tokens.map((x) => re.latinDigits(String(x)).toLowerCase()).join(" ").replace(/(\d)\s+(مليون|ملايين|million|ألف|الف|k|m)(?=\s|$)/gu, "$1$2");
  const out = {};
  const words = t.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^#\d+$/.test(w)) out.listing = Number(w.slice(1));
    else if (/^(عمولة|عموله|commission|comm)$/.test(w)) {
      const amount = re.parseAmount(words[++i] || "");
      if (!amount) throw new UserError("After عمولة write the amount, e.g. عمولة 80 ألف (or a rate like 2.5%).");
      out.commission = amount;
    } else if (/^\d+(?:\.\d+)?%$/.test(w)) {
      out.rate = Number(w.slice(0, -1));
      if (!(out.rate > 0 && out.rate <= 20)) throw new UserError("The commission rate is from 0.1% to 20%.");
    } else {
      const amount = re.parseAmount(w);
      if (!amount) throw new UserError(`I didn't understand "${w}". e.g. .lead won 5 #12 3.1m 2.5%`);
      out.price = amount;
    }
  }
  return out;
}

/** Records a deal on the client; marks the client won and the listing sold/rented. @returns {{ deal, lead, listing }} */
function close(state, leadId, args, by, now = Date.now()) {
  const lead = leads.get(state, leadId);
  if (!lead) throw new UserError(`There is no client #${leadId}.`);
  const listing = args.listing ? re.get(state, args.listing) : null;
  if (args.listing && !listing) throw new UserError(`There is no listing #${args.listing}.`);
  const price = args.price || listing?.price;
  if (!price) throw new UserError(`What was the price? e.g. .lead won ${leadId} #12 3.1m 2.5% (or a listing with a price)`);
  const commission = args.commission ?? (args.rate ? Math.round((price * args.rate) / 100) : undefined);
  const type = listing?.type || lead.type; // for the reports by unit type, even if the listing goes
  const deal = { ...(listing ? { listing: listing.id } : {}), ...(type ? { type } : {}), price, ...(commission ? { commission } : {}), ...(args.rate ? { rate: args.rate } : {}), kind: listing?.deal || lead.deal || "بيع", at: now };
  leads.update(state, leadId, { status: "won", deals: [...(lead.deals || []), deal] }, now);
  team.record(state, by, "deals", 1, now);
  if (commission) team.record(state, by, "commission", commission, now);
  const cur = re.agent(state).currency;
  leads.note(state, leadId, by, `✅ صفقة${listing ? ` #${listing.id}` : ""} بـ ${re.shortAr(price)} ${cur}${commission ? ` — عمولة ${re.money(commission, cur)}` : ""}`, now);
  if (listing && listing.status !== "sold" && listing.status !== "rented") re.update(state, listing.id, { status: deal.kind === "إيجار" ? "rented" : "sold" }, now);
  return { deal, lead: leads.get(state, leadId), listing: listing && re.get(state, listing.id) };
}

/** All deals with their client, newest first. */
const all = (state) =>
  leads
    .all(state)
    .flatMap((lead) => (lead.deals || []).map((deal) => ({ deal, lead })))
    .sort((a, b) => b.deal.at - a.deal.at);

/** "2026-10" of a time in the bot's time zone. */
const monthOf = (t, timeZone) => zoneNow(timeZone, t).day.slice(0, 7);

const previousMonth = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Deals in a month ("2026-10") or a year ("2026"). */
const inPeriod = (state, period, timeZone) => all(state).filter(({ deal }) => monthOf(deal.at, timeZone).startsWith(period));

const totals = (list) => ({
  count: list.length,
  value: list.reduce((a, { deal }) => a + deal.price, 0),
  commission: list.reduce((a, { deal }) => a + (deal.commission || 0), 0),
});

module.exports = { parseDealArgs, close, all, inPeriod, totals, monthOf, previousMonth };
