"use strict";

const { getJson, HttpError } = require("../../core/http");
const { LRU } = require("../../core/lru");
const { UserError } = require("../../core/errors");

/** Crypto prices from CoinGecko's free API (information only, not advice). */

const API = "https://api.coingecko.com/api/v3";
const ids = new LRU({ max: 500, ttlMs: 24 * 60 * 60 * 1000 });
// CoinGecko's free tier allows only a few calls a minute; prices are cached for 60 s.
const prices = new LRU({ max: 500, ttlMs: 60 * 1000 });

async function gecko(path) {
  const hit = prices.get(path);
  if (hit) return hit;
  try {
    const data = await getJson(`${API}${path}`, { timeoutMs: 15000 });
    prices.set(path, data);
    return data;
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw new UserError("CoinGecko's free limit was reached. Try again in a minute.");
    throw err;
  }
}
const SHORT = { btc: "bitcoin", eth: "ethereum", sol: "solana", bnb: "binancecoin", xrp: "ripple", ada: "cardano", doge: "dogecoin", ton: "the-open-network", trx: "tron", usdt: "tether", usdc: "usd-coin", ltc: "litecoin", dot: "polkadot" };

const fmt = (n) => {
  if (!Number.isFinite(n)) return "?";
  const opts = Math.abs(n) >= 1 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 4 };
  return new Intl.NumberFormat("en-US", opts).format(n);
};
const change = (p) => (Number.isFinite(p) ? `${p >= 0 ? "🟢 +" : "🔴 "}${p.toFixed(2)}%` : "");

async function coinId(query) {
  const q = query.toLowerCase();
  if (SHORT[q]) return SHORT[q];
  if (ids.get(q)) return ids.get(q);
  const found = await gecko(`/search?${new URLSearchParams({ query: q })}`);
  const coin = (found.coins || []).find((c) => c.symbol?.toLowerCase() === q || c.id === q) || found.coins?.[0];
  if (coin) ids.set(q, coin.id);
  return coin?.id || null;
}

/** USD → other currency with the same free rates as .currency. */
async function usdRate(currency) {
  if (currency === "USD") return 1;
  const data = await getJson("https://open.er-api.com/v6/latest/USD", { timeoutMs: 15000 });
  return data.rates?.[currency] || null;
}

module.exports = {
  name: "crypto",
  aliases: ["price", "btc"],
  category: "info",
  description: "Shows cryptocurrency prices and 24 h change (CoinGecko). Without a coin, the top 10. Information only — not financial advice.",
  usage: "[coin] [currency]",
  examples: [".crypto", ".crypto btc", ".crypto eth egp", ".crypto solana eur"],
  cooldown: 10,
  externalService: "coingecko.com, open.er-api.com",

  async run(ctx) {
    const coinArg = ctx.commandName === "btc" ? "btc" : ctx.args[0];
    const currency = String((ctx.commandName === "btc" ? ctx.args[0] : ctx.args[1]) || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return ctx.reply(`Usage: ${ctx.prefix}crypto <coin> [currency], e.g. ${ctx.prefix}crypto btc egp`);
    const rate = await usdRate(currency);
    if (!rate) return ctx.reply(`Unknown currency "${currency}".`);

    if (!coinArg) {
      const top = await gecko("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h");
      const lines = top.map((c, i) => `${i + 1}. *${c.symbol.toUpperCase()}* ${fmt(c.current_price * rate)} ${currency}  ${change(c.price_change_percentage_24h)}`);
      return ctx.reply(`💹 *Top 10 by market cap*\n\n${lines.join("\n")}\n\n_Information only, not financial advice._`);
    }
    if (!/^[\w.-]{1,40}$/.test(coinArg)) return ctx.reply("That is not a coin name.");
    const id = await coinId(coinArg);
    if (!id) return ctx.reply(`I couldn't find a coin called "${coinArg}".`);
    const data = await gecko(`/coins/markets?${new URLSearchParams({ vs_currency: "usd", ids: id, price_change_percentage: "24h,7d" })}`);
    const c = data[0];
    if (!c) return ctx.reply(`No price for "${coinArg}" right now.`);
    return ctx.reply(
      [
        `💹 *${c.name}* (${c.symbol.toUpperCase()})${c.market_cap_rank ? ` · rank #${c.market_cap_rank}` : ""}`,
        `Price: *${fmt(c.current_price * rate)} ${currency}*`,
        `24 h: ${change(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h)}   7 d: ${change(c.price_change_percentage_7d_in_currency)}`,
        `24 h range: ${fmt(c.low_24h * rate)} – ${fmt(c.high_24h * rate)} ${currency}`,
        c.market_cap ? `Market cap: ${fmt(c.market_cap * rate)} ${currency}` : "",
        "",
        "_Information only, not financial advice._",
      ]
        .filter((l, i, a) => l || (i > 0 && a[i - 1]))
        .join("\n"),
    );
  },
};
