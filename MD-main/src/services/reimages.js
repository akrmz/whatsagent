"use strict";

const fs = require("node:fs");
const sharp = require("sharp");
const re = require("./realestate");

/** Pictures for property marketing, drawn on the server with sharp: listing flyers and watermarks. */

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
const FONT = "DejaVu Sans, Arial, sans-serif";
// Arabic lines are laid out right-to-left (otherwise "150 م²" splits up and "3,500,000 جنيه" reads backwards);
// phone numbers and other digit groups are isolated so "+20 100 123 4567" keeps its order.
const RTL = `direction="rtl" text-anchor="start"`;
const isolateNumbers = (s) => String(s).replace(/[+\d][\d\s-]{5,}\d/g, (m) => `\u2066${m}\u2069`);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

const W = 1080;
const H = 1350;
const PHOTO_H = 820;

/** Any picture → JPEG for storing with a listing (at most 1600 px, orientation fixed). */
const toListingJpeg = (buffer) =>
  sharp(buffer, { limitInputPixels: 64e6, animated: false }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer();

/**
 * A 1080×1350 flyer (the size WhatsApp status and Instagram use): the listing's first photo,
 * then a panel with the type, location, price, specs and the agent's contact.
 */
async function flyer(listing, agent, photoPath) {
  const cur = agent.currency || "جنيه";
  const photo = photoPath && fs.existsSync(photoPath)
    ? await sharp(photoPath).resize(W, PHOTO_H, { fit: "cover", position: "attention" }).toBuffer()
    : await sharp(Buffer.from(`<svg width="${W}" height="${PHOTO_H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3b57"/><stop offset="1" stop-color="#3f6e8c"/></linearGradient></defs><rect width="${W}" height="${PHOTO_H}" fill="url(#g)"/><text x="${W / 2}" y="${PHOTO_H / 2 + 60}" font-size="180" text-anchor="middle" font-family="${FONT}">🏠</text></svg>`)).png().toBuffer();
  const title = `${listing.type || "عقار"} لل${listing.deal || "بيع"}`;
  const price = listing.price ? `${re.group(listing.price)} ${cur}${listing.deal === "إيجار" ? " / شهر" : ""}` : "السعر عند التواصل";
  const specs = [listing.size && `${re.group(listing.size)} م²`, listing.rooms && `${listing.rooms} غرف`, listing.baths && `${listing.baths} حمام`, listing.finishing && clip(listing.finishing, 16)].filter(Boolean).join("   •   ");
  const contact = [agent.name, agent.phone].filter(Boolean).join("   ") || "";
  const rtlContact = /[\u0600-\u06FF]/.test(contact);
  const status = listing.status && listing.status !== "available" ? re.STATUS_AR[listing.status].replace(/^\S+\s/, "") : "";
  const cut = !status && re.discount(listing); // a recent price cut, shown as a badge and the old price struck through
  const badge = status
    ? `<rect x="${W - 300}" y="40" rx="18" width="260" height="64" fill="#b3261e" fill-opacity="0.9"/><text x="${W - 170}" y="84" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle" font-family="${FONT}">${esc(status)}</text>`
    : cut
      ? `<rect x="${W - 300}" y="40" rx="18" width="260" height="64" fill="#e0b25b"/><text x="${W - 170}" y="84" font-size="34" font-weight="bold" fill="#0f2233" text-anchor="middle" direction="rtl" font-family="${FONT}">خصم \u2066${cut.pct}%\u2069</text>`
      : "";
  // Right-to-left like the price (so it reads "3,600,000 جنيه"), anchored at its left end.
  const was = cut ? `<text x="60" y="${PHOTO_H + 262}" font-size="40" fill="#9fb0bf" text-decoration="line-through" direction="rtl" text-anchor="end" font-family="${FONT}">${esc(`${re.group(cut.was)} ${cur}`)}</text>` : "";
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect y="${PHOTO_H}" width="${W}" height="${H - PHOTO_H}" fill="#0f2233"/>
  <rect y="${PHOTO_H}" width="${W}" height="8" fill="#e0b25b"/>
  <rect x="40" y="40" rx="18" width="190" height="64" fill="#0f2233" fill-opacity="0.82"/>
  <text x="135" y="84" font-size="34" font-weight="bold" fill="#e0b25b" text-anchor="middle" font-family="${FONT}">#${listing.id}</text>
  ${badge}
  <text x="${W - 60}" y="${PHOTO_H + 95}" font-size="62" font-weight="bold" fill="#ffffff" ${RTL} font-family="${FONT}">${esc(title)}</text>
  ${listing.location ? `<text x="${W - 60}" y="${PHOTO_H + 160}" font-size="38" fill="#b9c7d3" ${RTL} font-family="${FONT}">📍 ${esc(clip(listing.location, 40))}</text>` : ""}
  <text x="${W - 60}" y="${PHOTO_H + 265}" font-size="76" font-weight="bold" fill="#e0b25b" ${RTL} font-family="${FONT}">${esc(price)}</text>
  ${was}
  ${specs ? `<text x="${W - 60}" y="${PHOTO_H + 345}" font-size="38" fill="#ffffff" ${RTL} font-family="${FONT}">${esc(specs)}</text>` : ""}
  ${contact ? `<rect y="${H - 110}" width="${W}" height="110" fill="#e0b25b"/><text x="${W / 2}" y="${H - 42}" font-size="44" font-weight="bold" fill="#0f2233" text-anchor="middle"${rtlContact ? ` direction="rtl"` : ""} font-family="${FONT}">📞 ${esc(isolateNumbers(clip(contact, 44)))}</text>` : ""}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: "#0f2233" } })
    .composite([
      { input: photo, top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Text in a dark rounded box in the bottom corner (bottom-left for Arabic text), sized to the picture. */
async function watermark(buffer, text) {
  const img = sharp(buffer, { limitInputPixels: 64e6, animated: false }).rotate();
  const { data, info } = await img.flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const size = Math.max(16, Math.round(Math.min(width, height) / 22));
  const label = clip(text, 60);
  const boxW = Math.min(width - 2 * size, Math.round(label.length * size * 0.55 + size * 1.4));
  const boxH = Math.round(size * 1.9);
  const arabic = /[؀-ۿ]/.test(label);
  const x = arabic ? size : width - size - boxW;
  const y = height - size - boxH;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${x}" y="${y}" rx="${Math.round(size / 2)}" width="${boxW}" height="${boxH}" fill="#000" fill-opacity="0.55"/><text x="${x + boxW / 2}" y="${y + boxH / 2 + size * 0.36}" font-size="${size}" font-weight="bold" fill="#fff" fill-opacity="0.95" text-anchor="middle"${arabic ? ` direction="rtl"` : ""} font-family="${FONT}">${esc(isolateNumbers(label))}</text></svg>`;
  return sharp(data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

module.exports = { flyer, watermark, toListingJpeg };
