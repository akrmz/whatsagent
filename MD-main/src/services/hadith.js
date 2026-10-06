"use strict";

const crypto = require("node:crypto");
const http = require("../core/http");

// Replaceable in tests (offline fixtures).
let getJson = http.getJson;
const setFetcher = (fn) => (getJson = fn || http.getJson);
const { LRU } = require("../core/lru");

/**
 * Hadiths from HadeethEnc — موسوعة الأحاديث النبوية (hadeethenc.com), with the grade,
 * source and a short explanation. Used live through its public developer API.
 */

const API = "https://hadeethenc.com/api/v1";
const PER_PAGE = 20;
const MAX_EXPLANATION = 700;
const cache = new LRU({ max: 50, ttlMs: 24 * 60 * 60 * 1000 });

async function cached(key, url) {
  const hit = cache.get(key);
  if (hit) return hit;
  const data = await getJson(url, { timeoutMs: 20000 });
  cache.set(key, data);
  return data;
}

/** A random hadith id: category picked in proportion to its size, then a random item in it. */
async function randomId() {
  const roots = (await cached("roots", `${API}/categories/roots/?language=ar`)).filter((c) => Number(c.hadeeths_count) > 0);
  const total = roots.reduce((n, c) => n + Number(c.hadeeths_count), 0);
  let pick = crypto.randomInt(total);
  const root = roots.find((c) => (pick -= Number(c.hadeeths_count)) < 0) || roots[0];
  const index = crypto.randomInt(Number(root.hadeeths_count));
  const page = Math.floor(index / PER_PAGE) + 1;
  const list = await getJson(`${API}/hadeeths/list/?language=ar&category_id=${root.id}&page=${page}&per_page=${PER_PAGE}`, { timeoutMs: 20000 });
  const items = list.data || [];
  if (!items.length) throw new Error("empty hadith page");
  return items[index % PER_PAGE]?.id || items[0].id;
}

async function byId(id) {
  if (!/^\d{1,7}$/.test(String(id))) return null;
  const h = await getJson(`${API}/hadeeths/one/?language=ar&id=${id}`, { timeoutMs: 20000 });
  return h?.hadeeth ? h : null;
}

const randomHadith = async () => byId(await randomId());

/** Message text: the hadith, its grade and source, and a short explanation. */
function format(h) {
  const explanation = String(h.explanation || "").trim();
  const short = explanation.length > MAX_EXPLANATION ? `${explanation.slice(0, MAX_EXPLANATION).replace(/\s+\S*$/, "")}…` : explanation;
  return [
    `📜 *${h.title}*`,
    "",
    String(h.hadeeth).trim(),
    "",
    `📌 ${[h.grade && `الدرجة: ${h.grade}`, h.attribution && `رواه: ${h.attribution}`].filter(Boolean).join(" · ")}`,
    short ? `\n💡 *الشرح:* ${short}` : null,
    `\n_موسوعة الأحاديث النبوية — hadeethenc.com (${h.id})_`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

module.exports = { setFetcher, randomHadith, byId, format };
