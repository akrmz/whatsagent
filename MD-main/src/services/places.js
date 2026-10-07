"use strict";

const http = require("../core/http");

/**
 * Listing locations: coordinates from a WhatsApp location pin, a Google Maps link or plain
 * "lat, lng" text; distances; map links. Short Maps links (maps.app.goo.gl, goo.gl/maps) are
 * expanded by reading their redirects — only to Google hosts, without loading the pages.
 */

// Replaceable in tests (offline fixtures).
let request = http.request;
const setRequester = (fn) => (request = fn || http.request);

const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const round = (n) => Math.round(n * 1e6) / 1e6;
const point = (lat, lng, label) => (valid(lat, lng) ? { lat: round(lat), lng: round(lng), ...(label ? { label: String(label).slice(0, 80) } : {}) } : null);

/** A WhatsApp location (or live location) message → { lat, lng, label? } */
function fromMessage(message) {
  const m = message?.locationMessage || message?.liveLocationMessage;
  if (!m) return null;
  return point(Number(m.degreesLatitude), Number(m.degreesLongitude), m.name || m.address);
}

/**
 * Coordinates written in a Maps link or as text. The most precise form wins: a place's
 * "!3d…!4d…", then "?q=/query=/ll=", then the map centre "@lat,lng", then plain "lat, lng".
 */
function fromText(text) {
  const t = String(text || "").replace(/%2C/gi, ",").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٫/g, ".").replace(/،/g, ",");
  const num = String.raw`(-?\d{1,3}\.\d{3,})`;
  const patterns = [
    new RegExp(String.raw`!3d${num}!4d${num}`),
    new RegExp(String.raw`[?&](?:q|query|ll|destination|center)=(?:loc:)?${num},\s*${num}`),
    new RegExp(String.raw`@${num},${num}`),
    new RegExp(String.raw`(?:^|[\s(])${num}\s*,\s*${num}(?=$|[\s)])`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const p = point(Number(m[1]), Number(m[2]));
      if (p) return p;
    }
  }
  return null;
}

const SHORT = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+/i;
/** Any Google Maps link (full or short), e.g. inside a broker's post. */
const MAP_LINK = /https?:\/\/(?:[\w-]+\.)*(?:google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s<>"]*/iu;
const MAP_LINKS = new RegExp(MAP_LINK.source, "giu");
/** Plain "lat, lng" written in text (to take it out of a search). */
const COORDS = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;
const GOOGLE_HOST = /^(?:www\.)?(?:google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl|consent\.google\.com)$/i;

/** Follows a short Maps link's redirects (at most 4, Google hosts only) to read its coordinates. */
async function expandShort(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await request(current, { method: "GET", followRedirects: false, throwOnStatus: false, timeoutMs: 10000, maxBytes: 512 * 1024, headers: { "user-agent": "curl/8.9.1" } });
    } catch {
      return null;
    }
    if (!res.redirect) return null;
    const found = fromText(decodeURIComponent(res.redirect));
    if (found) return found;
    let next;
    try {
      next = new URL(res.redirect);
    } catch {
      return null;
    }
    if (next.protocol !== "https:" || !GOOGLE_HOST.test(next.hostname)) return null;
    current = next.toString();
  }
  return null;
}

/** Coordinates from text that may hold a full or a short Maps link. */
async function fromTextOrLink(text) {
  const direct = fromText(text);
  if (direct) return direct;
  const short = String(text || "").match(SHORT);
  return short ? expandShort(short[0]) : null;
}

/** Great-circle distance in km (haversine). */
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const mapsUrl = (p) => `https://maps.google.com/?q=${p.lat},${p.lng}`;
const km = (d) => (d < 1 ? `${Math.round(d * 1000)} م` : `${d < 10 ? d.toFixed(1) : Math.round(d)} كم`);

module.exports = { fromMessage, fromText, fromTextOrLink, expandShort, distanceKm, mapsUrl, km, setRequester, SHORT, MAP_LINK, MAP_LINKS, COORDS };
