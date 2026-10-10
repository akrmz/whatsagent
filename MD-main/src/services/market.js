"use strict";

const re = require("./realestate");

/**
 * Market figures from the agent's own catalogue (including reserved and sold listings, which
 * are real asking prices too): price per m² by area and type, and how one listing's price
 * compares with similar ones. Only as good as the listings saved; not a valuation.
 */

const MIN_SIMILAR = 3;

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

/** Price per m² (sale) or monthly rent per m² (rent); null without both a price and a size. */
const ppm = (l) => (l.price > 0 && l.size > 0 ? l.price / l.size : null);

/** Summary of a group of listings: count, median and middle half (25–75%) of price per m², median price and size. */
function summarize(list) {
  const ppms = list.map(ppm).filter((v) => v !== null).sort((a, b) => a - b);
  const prices = list.map((l) => l.price).filter((p) => p > 0).sort((a, b) => a - b);
  const sizes = list.map((l) => l.size).filter((s) => s > 0).sort((a, b) => a - b);
  return {
    count: list.length,
    priced: ppms.length,
    median: quantile(ppms, 0.5),
    low: quantile(ppms, 0.25),
    high: quantile(ppms, 0.75),
    min: ppms[0] ?? null,
    max: ppms.at(-1) ?? null,
    medianPrice: quantile(prices, 0.5),
    medianSize: quantile(sizes, 0.5),
  };
}

/** "التجمع الخامس، النرجس" → "التجمع الخامس" (the part before a comma or dash), for grouping by area. */
const areaOf = (location) =>
  String(location || "")
    .split(/[،,\-–—(/]/)[0]
    .replace(/^(?:في|ب)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

/**
 * Figures for a search (the same filters as .listings, always including reserved and sold).
 * Without location words, grouped by area; otherwise grouped by type.
 */
function report(state, query) {
  const { list, filters, words } = re.search(state, `${query || ""} all`);
  const byKey = (key) => {
    const groups = new Map();
    for (const l of list) {
      const k = key(l);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    return [...groups].map(([name, items]) => ({ name, ...summarize(items) })).sort((a, b) => b.priced - a.priced || b.count - a.count);
  };
  return {
    filters,
    words,
    total: summarize(list),
    groups: words.length ? byKey((l) => `${l.type || "عقار"} لل${l.deal || "بيع"}`) : byKey((l) => areaOf(l.location) && `${areaOf(l.location)} · ${l.type || "عقار"} لل${l.deal || "بيع"}`),
  };
}

/** Location words two listings share (3+ letters, ignoring "ال"), to find similar ones. */
const placeWords = (l) =>
  new Set(
    String(l.location || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^ال/u, ""))
      .filter((w) => w.length >= 3 && !/^(كمبوند|مدينة|منطقة|شارع|حي|بجوار|قريب)$/u.test(w)),
  );

/**
 * How a listing's price per m² compares with similar listings (same type and deal, sharing a
 * location word). @returns {{ similar, stats, ppm, diffPct, range } | { similar, stats: null }}
 */
function compareToMarket(state, listing) {
  const mine = placeWords(listing);
  const similar = re
    .all(state)
    .filter((l) => l.id !== listing.id && l.type === listing.type && (l.deal || "بيع") === (listing.deal || "بيع") && ppm(l) !== null)
    .filter((l) => [...placeWords(l)].some((w) => mine.has(w)));
  if (similar.length < MIN_SIMILAR || ppm(listing) === null) return { similar, stats: null };
  const stats = summarize(similar);
  const own = ppm(listing);
  return {
    similar,
    stats,
    ppm: own,
    diffPct: Math.round((own / stats.median - 1) * 100),
    // The asking price that would put it in the middle half of similar listings.
    range: listing.size ? [stats.low * listing.size, stats.high * listing.size] : null,
  };
}

module.exports = { report, compareToMarket, summarize, ppm, areaOf, placeWords, quantile, MIN_SIMILAR };
