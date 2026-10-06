"use strict";

const { getJson } = require("../core/http");
const { LRU } = require("../core/lru");

/**
 * Gold and silver spot prices (gold-api.com, free) converted to any currency with the
 * same free exchange rates as .currency. Global spot prices: shops add their own margin
 * and some countries have a local premium.
 */

const GRAMS_PER_OUNCE = 31.1034768;
const cache = new LRU({ max: 20, ttlMs: 10 * 60 * 1000 });

async function cached(key, url) {
  const hit = cache.get(key);
  if (hit) return hit;
  const data = await getJson(url, { timeoutMs: 15000 });
  cache.set(key, data);
  return data;
}

async function usdRate(currency) {
  if (currency === "USD") return 1;
  const data = await cached("fx", "https://open.er-api.com/v6/latest/USD");
  return data.rates?.[currency] || null;
}

/** @returns {Promise<{ currency, gold24: number, silver: number, ounceUsd: number, updated: string }>} per gram */
async function prices(currency = "USD") {
  const [gold, silver, rate] = await Promise.all([
    cached("XAU", "https://api.gold-api.com/price/XAU"),
    cached("XAG", "https://api.gold-api.com/price/XAG"),
    usdRate(currency),
  ]);
  if (!rate) return null;
  if (!Number.isFinite(gold.price) || !Number.isFinite(silver.price)) throw new Error("no metal prices");
  return {
    currency,
    gold24: (gold.price / GRAMS_PER_OUNCE) * rate,
    silver: (silver.price / GRAMS_PER_OUNCE) * rate,
    ounceUsd: gold.price,
    updated: gold.updatedAt || "",
  };
}

// Zakat nisab: 85 g of gold or 595 g of silver; zakat is 2.5 % (a quarter of a tenth).
const NISAB_GOLD_G = 85;
const NISAB_SILVER_G = 595;
const RATE = 0.025;

function zakat(amount, p) {
  const nisabGold = NISAB_GOLD_G * p.gold24;
  const nisabSilver = NISAB_SILVER_G * p.silver;
  return { nisabGold, nisabSilver, due: amount * RATE, aboveGold: amount >= nisabGold, aboveSilver: amount >= nisabSilver };
}

module.exports = { prices, zakat, NISAB_GOLD_G, NISAB_SILVER_G, GRAMS_PER_OUNCE };
