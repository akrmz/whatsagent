"use strict";

const { getJson } = require("../../core/http");
const { UserError } = require("../../core/errors");
const { LRU } = require("../../core/lru");

// 5224.751 → "5,224.75"; values below 1 keep enough digits to be useful (0.0001914).
const money = (n) =>
  new Intl.NumberFormat("en-US", n !== 0 && Math.abs(n) < 1 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: 2 }).format(n);

// Rates are published daily; one fetch per base currency per hour is plenty.
const rates = new LRU({ max: 50, ttlMs: 60 * 60 * 1000 });

async function getRates(base) {
  const cached = rates.get(base);
  if (cached) return cached;
  const data = await getJson(`https://open.er-api.com/v6/latest/${base}`, { timeoutMs: 15000 });
  if (data.result !== "success") throw new UserError(`Unknown currency "${base}".`);
  rates.set(base, data);
  return data;
}

/** Accepts "100 usd egp", "100 usd to egp", "usd egp", "100usd in eur". */
function parse(text) {
  const m = String(text)
    .trim()
    .match(/^([\d.,]+)?\s*([a-z]{3})\s+(?:to\s+|in\s+|=\s*)?([a-z]{3})$/i);
  if (!m) return null;
  const amount = m[1] ? Number(m[1].replace(/,/g, "")) : 1;
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, from: m[2].toUpperCase(), to: m[3].toUpperCase() };
}

module.exports = {
  name: "currency",
  aliases: ["convert", "cur", "exchange"],
  category: "tools",
  description: "Converts money between currencies with today's exchange rate.",
  usage: "[amount] <from> <to>",
  examples: [".currency 100 usd egp", ".convert 50 eur to usd", ".cur usd sar"],
  cooldown: 5,
  externalService: "open.er-api.com (ExchangeRate-API)",
  parse,

  async run(ctx) {
    const q = parse(ctx.text);
    if (!q) return ctx.reply(`Usage: ${ctx.prefix}currency 100 usd egp`);
    const data = await getRates(q.from);
    const rate = data.rates?.[q.to];
    if (!rate) return ctx.reply(`Unknown currency "${q.to}".`);
    const updated = data.time_last_update_utc ? `\n_Rate from ${data.time_last_update_utc.replace(/ \+0000$/, " UTC")}_` : "";
    return ctx.reply(
      `💱 ${money(q.amount)} ${q.from} = *${money(q.amount * rate)} ${q.to}*\n1 ${q.from} = ${money(rate)} ${q.to}${updated}`,
    );
  },
};
