"use strict";

const sharp = require("sharp");
const re = require("./realestate");
const market = require("./market");
const { esc, isolateNumbers, clip, FONT, RTL } = require("./reimages");

/**
 * ".compare 3 7 12 image": up to 3 listings side by side as one picture to send a client
 * (1080×1350): each one's photo, type and area, then a row per detail — price, size, price per
 * m², rooms, the payment plan (down payment and years, or cash) and the features — with the
 * best price per m² marked, and the agent's contact. Rows are labelled in words (the server's
 * font may not have emoji).
 */

const W = 1080;
const H = 1350;
const LABEL_W = 170; // the label column, on the right
const SIDE = 40;
const PHOTO_H = 250;
const MAX = 3;

const text = (x, y, size, body, { fill = "#0f2233", bold = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}"${bold ? ` font-weight="bold"` : ""} fill="${fill}" ${RTL} font-family="${FONT}">${esc(isolateNumbers(body))}</text>`;

/** The first photo, cropped to fill its box; null without one. */
async function photo(config, l, w, h) {
  const [file] = re.photos(config, l);
  if (!file) return null;
  return sharp(file, { limitInputPixels: 64e6 }).rotate().resize(w, h, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
}

const plan = (l) => (l.down ? `مقدم ${re.shortAr(l.down)}${l.years ? ` + ${l.years} سنين` : ""}` : l.deal === "إيجار" ? "—" : "كاش");

/** The rows: [label, value for each listing, best index or -1]. */
function rows(listings, cur) {
  const ppms = listings.map((l) => (l.deal === "إيجار" ? null : market.ppm(l)));
  const priced = ppms.filter((v) => v !== null);
  const best = priced.length > 1 ? ppms.indexOf(Math.min(...priced)) : -1;
  const feats = listings.map((l) => re.featuresOf(l));
  return [
    [`السعر (${cur})`, listings.map((l) => (l.price ? `${re.group(l.price)}${l.deal === "إيجار" ? " /شهر" : ""}` : "—")), -1],
    ["المساحة", listings.map((l) => (l.size ? `${re.group(l.size)} م` : "—")), -1],
    ["سعر المتر", ppms.map((v) => (v ? re.group(Math.round(v)) : "—")), best],
    ["الغرف", listings.map((l) => (l.rooms ? `${l.rooms} غرف${l.baths ? ` · ${l.baths} حمام` : ""}` : "—")), -1],
    ["الدفع", listings.map(plan), -1],
    ["المميزات", feats.map((f) => (f.length ? f.slice(0, 2).join("، ") : "—")), -1],
    ["", feats.map((f) => (f.length > 2 ? f.slice(2, 4).join("، ") : "")), -1],
  ];
}

/** The picture (JPEG). @param {object[]} listings 2 or 3 */
async function render(state, config, listings) {
  const a = re.agent(state);
  const cur = a.currency || "جنيه";
  const n = listings.length;
  const colW = Math.floor((W - 2 * SIDE - LABEL_W) / n);
  // Columns read right to left: the first listing next to the labels.
  const colX = (i) => W - SIDE - LABEL_W - (i + 1) * colW; // left edge
  const top = 160;
  const parts = [];
  const overlays = [];
  for (const [i, l] of listings.entries()) {
    const x = colX(i);
    const p = await photo(config, l, colW - 16, PHOTO_H);
    if (p) overlays.push({ input: p, left: x + 8, top });
    else parts.push(`<rect x="${x + 8}" y="${top}" width="${colW - 16}" height="${PHOTO_H}" rx="12" fill="#e8edf2"/>`, text(x + colW - 24, top + PHOTO_H / 2 + 12, 30, l.type || "عقار", { fill: "#8a99a8" }));
    parts.push(text(x + colW - 16, top + PHOTO_H + 48, 32, `#${l.id} · ${l.type || "عقار"}`, { bold: true }));
    parts.push(text(x + colW - 16, top + PHOTO_H + 88, 24, clip(l.location || "—", 22), { fill: "#5a6b7a" }));
  }
  const table = rows(listings, cur);
  const rowTop = top + PHOTO_H + 175;
  const rowH = 82;
  for (const [r, [label, values, best]] of table.entries()) {
    const y = rowTop + r * rowH;
    if (r % 2 === 0 && label) parts.push(`<rect x="${SIDE}" y="${y - 46}" width="${W - 2 * SIDE}" height="${rowH}" fill="#f1f4f7"/>`);
    if (label) parts.push(text(W - SIDE - 16, y, label.length > 8 ? 22 : 26, label, { fill: "#5a6b7a", bold: true }));
    values.forEach((v, i) => {
      if (!v) return;
      const isBest = i === best;
      parts.push(text(colX(i) + colW - 16, y, v.length > 16 ? 22 : 27, v, { bold: isBest, fill: isBest ? "#1b7a43" : "#0f2233" }));
      if (isBest) parts.push(text(colX(i) + colW - 16, y + 24, 18, "أفضل سعر للمتر", { fill: "#1b7a43" }));
    });
  }
  const contact = re.contactLine(a);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="130" fill="#0f2233"/>
  ${text(W - 50, 85, 52, "مقارنة الوحدات", { fill: "#ffffff", bold: true })}
  ${parts.join("\n")}
  <rect y="${H - 100}" width="${W}" height="100" fill="#0f2233"/>
  ${contact ? text(W - 50, H - 40, 28, clip(contact, 60), { fill: "#ffffff" }) : ""}
</svg>`;
  return sharp(Buffer.from(svg)).composite(overlays).jpeg({ quality: 88 }).toBuffer();
}

module.exports = { render, rows, MAX };
