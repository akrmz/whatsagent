"use strict";

const re = require("./realestate");

/**
 * What available listings are missing (.listings check, and a weekly line in the morning
 * summary): matching, campaigns, the market figures and the customer assistant are only as good
 * as the details saved. Each gap has a weight (photos and the price matter most) and the command
 * that fills it.
 */

const DAY = 86400000;
const STALE_DAYS = 30;
// Units described by their rooms (land, shops, offices and buildings aren't).
const ROOMED = new Set(["شقة", "فيلا", "دوبلكس", "بنتهاوس", "تاون هاوس", "توين هاوس", "شاليه"]);

/** The gaps of one listing, most important first: [{ key, label, weight, fix }] */
function gaps(l, p = ".", now = Date.now()) {
  const out = [];
  const add = (key, label, weight, fix) => out.push({ key, label, weight, fix });
  if (!(l.photos > 0)) add("photos", "📷 صور", 3, `${p}listing photo ${l.id} (على صورة)`);
  if (!l.price) add("price", "💰 السعر", 3, `${p}listing edit ${l.id} السعر: …`);
  if (!l.size) add("size", "📐 المساحة", 2, `${p}listing edit ${l.id} المساحة: …`);
  if (!l.location) add("location", "📍 المنطقة", 2, `${p}listing edit ${l.id} المنطقة: …`);
  if (ROOMED.has(l.type) && !l.rooms) add("rooms", "🛏 الغرف", 1, `${p}listing edit ${l.id} الغرف: …`);
  if (!l.geo) add("geo", "🗺️ اللوكيشن", 1, `${p}listing loc ${l.id} (على لوكيشن)`);
  if (!l.owner?.phone) add("owner", "🔑 رقم المالك", 1, `${p}listing edit ${l.id} المالك: الاسم 0100…`);
  const age = Math.floor((now - (l.updated || l.created)) / DAY);
  if (age >= STALE_DAYS) add("stale", `🕸️ من ${age} يوم`, 1, l.owner?.phone ? `${p}listing ask ${l.id}` : `${p}listing status ${l.id} …`);
  return out;
}

/** Available listings with something missing, the most incomplete first. @returns {{ list: [{ listing, gaps, weight }], total }} */
function check(state, p = ".", now = Date.now()) {
  const available = re.all(state).filter((l) => l.status === "available");
  const list = available
    .map((listing) => {
      const g = gaps(listing, p, now);
      return { listing, gaps: g, weight: g.reduce((n, x) => n + x.weight, 0) };
    })
    .filter((x) => x.gaps.length)
    .sort((a, b) => b.weight - a.weight || a.listing.id - b.listing.id);
  return { list, total: available.length };
}

/** How many available listings miss each thing: { photos: 3, price: 1, … } */
function counts(state, now = Date.now()) {
  const out = {};
  for (const { gaps: g } of check(state, ".", now).list) for (const x of g) out[x.key] = (out[x.key] || 0) + 1;
  return out;
}

module.exports = { gaps, check, counts, STALE_DAYS };
