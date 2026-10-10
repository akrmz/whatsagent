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
    // A commission shared with another broker: "split 50%", "شراكة 40%", or "مناصفة" (half).
    if (/^(مناصفة|مناصفه|بالنص)$/.test(w)) out.split = 50;
    else if (/^(split|share|شراكة|شراكه|مشاركة|مشاركه)$/.test(w)) {
      out.split = Number(String(words[++i] || "").replace(/%$/, ""));
      if (!(out.split >= 1 && out.split <= 99)) throw new UserError("Your share after split: a percentage from 1 to 99, e.g. split 50%.");
    } else if (/^#\d+$/.test(w)) out.listing = Number(w.slice(1));
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
  const gross = args.commission ?? (args.rate ? Math.round((price * args.rate) / 100) : undefined);
  // Shared with another broker: the commission counted is your share; the whole is kept beside it.
  const commission = gross && args.split ? Math.round((gross * args.split) / 100) : gross;
  const partner = args.split ? listing?.source?.phones?.[0] : undefined;
  const type = listing?.type || lead.type; // for the reports by unit type, even if the listing goes
  const deal = {
    ...(listing ? { listing: listing.id } : {}),
    ...(type ? { type } : {}),
    price,
    ...(commission ? { commission } : {}),
    ...(args.rate ? { rate: args.rate } : {}),
    ...(args.split ? { split: args.split, ...(gross ? { gross } : {}), ...(partner ? { partner } : {}) } : {}),
    kind: listing?.deal || lead.deal || "بيع",
    at: now,
    by, // whose team counters it went to
  };
  leads.update(state, leadId, { status: "won", deals: [...(lead.deals || []), deal] }, now);
  team.record(state, by, "deals", 1, now);
  if (commission) team.record(state, by, "commission", commission, now);
  const cur = re.agent(state).currency;
  leads.note(state, leadId, by, `✅ صفقة${listing ? ` #${listing.id}` : ""} بـ ${re.shortAr(price)} ${cur}${commission ? ` — عمولة ${re.money(commission, cur)}${args.split ? ` (نصيبك ${args.split}% من ${re.money(gross, cur)})` : ""}` : ""}`, now);
  if (listing && listing.status !== "sold" && listing.status !== "rented") re.update(state, listing.id, { status: deal.kind === "إيجار" ? "rented" : "sold" }, now);
  return { deal, lead: leads.get(state, leadId), listing: listing && re.get(state, listing.id) };
}

/**
 * ".lead split 5 50%": the client's last deal was shared with another broker after all. Its
 * commission becomes your share (of the whole), and the team's count is corrected by the
 * difference. @returns {{ deal, lead, before }}
 */
function setSplit(state, leadId, pct, by, now = Date.now()) {
  const lead = leads.get(state, leadId);
  if (!lead) throw new UserError(`There is no client #${leadId}.`);
  const last = lead.deals?.at(-1);
  if (!last) throw new UserError(`#${leadId} has no deal recorded (.lead won ${leadId} …).`);
  if (!(pct >= 1 && pct <= 100)) throw new UserError("Your share: a percentage from 1 to 100 (100 = not shared), e.g. .lead split 5 50%");
  const gross = last.gross ?? last.commission;
  if (!gross) throw new UserError(`The deal has no commission to share. Record it with the commission: .lead won ${leadId} … 2.5% split ${pct}%`);
  const before = last.commission || 0;
  const commission = Math.round((gross * pct) / 100);
  const listing = last.listing ? re.get(state, last.listing) : null;
  const deal = { ...last, commission, ...(pct < 100 ? { split: pct, gross, ...(listing?.source?.phones?.[0] ? { partner: listing.source.phones[0] } : {}) } : {}) };
  if (pct === 100) for (const k of ["split", "gross", "partner"]) delete deal[k];
  leads.update(state, leadId, { deals: [...lead.deals.slice(0, -1), deal] }, now);
  team.adjust(state, last.by || by, "commission", commission - before, last.at);
  const cur = re.agent(state).currency;
  leads.note(state, leadId, by, pct < 100 ? `🤝 العمولة مقسومة: نصيبك ${pct}% = ${re.money(commission, cur)} من ${re.money(gross, cur)}` : `🤝 العمولة كلها ليك: ${re.money(commission, cur)}`, now);
  return { deal, lead: leads.get(state, leadId), before };
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

module.exports = { parseDealArgs, close, setSplit, all, inPeriod, totals, monthOf, previousMonth };
