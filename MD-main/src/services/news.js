"use strict";

const { request } = require("../core/http");
const { decodeEntities } = require("./webtext");
const { LRU } = require("../core/lru");

/**
 * Headlines from the Google News RSS feed (no API key), for any country and language.
 * Only titles, source and time are shown, as in a feed reader.
 */

const cache = new LRU({ max: 200, ttlMs: 10 * 60 * 1000 });

function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => decodeEntities((m[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const source = tag("source");
    let title = tag("title");
    // Google appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    items.push({ title, source, link: tag("link"), date: Date.parse(tag("pubDate")) || 0 });
  }
  return items;
}

async function fetchFeed(url) {
  const res = await request(url, { timeoutMs: 15000, maxBytes: 3 * 1024 * 1024, headers: { accept: "application/rss+xml,application/xml" } });
  return parseRss(res.body.toString("utf8"));
}

/** @param {string} region "EG:ar", "US:en" …  @param {string} [query] search words */
async function headlines(region, query = "") {
  const [country, lang] = region.split(":");
  const key = `${region}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = query ? "rss/search" : "rss";
  // Google accepts "hl=ar" for some languages and only "hl=en-GB" style for others.
  let items = [];
  for (const hl of [lang, `${lang}-${country}`]) {
    const qs = new URLSearchParams({ ...(query ? { q: query } : {}), hl, gl: country, ceid: `${country}:${lang}` });
    items = await fetchFeed(`https://news.google.com/${path}?${qs}`);
    if (items.length) break;
  }
  cache.set(key, items);
  return items;
}

function ago(date, now = Date.now()) {
  if (!date) return "";
  const m = Math.max(0, Math.round((now - date) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

module.exports = { headlines, parseRss, ago };
