"use strict";

const fs = require("node:fs");
const sharp = require("sharp");
const re = require("./realestate");
const english = require("./english");

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
async function flyer(listing, agent, photoPath, { lang = "ar" } = {}) {
  const en = lang === "en";
  const d = en ? english.details(listing, agent) : details(listing, agent);
  const photo = await tile(photoPath, W, PHOTO_H);
  // Arabic reads from the right edge, English from the left.
  const side = en ? { x: 60, attrs: `text-anchor="start"` } : { x: W - 60, attrs: RTL };
  const location = en ? d.location : listing.location;
  const rtlContact = /[؀-ۿ]/.test(d.contact);
  const badge = d.status
    ? `<rect x="${W - 300}" y="40" rx="18" width="260" height="64" fill="#b3261e" fill-opacity="0.9"/><text x="${W - 170}" y="84" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle" font-family="${FONT}">${esc(d.status)}</text>`
    : d.cut
      ? `<rect x="${W - 300}" y="40" rx="18" width="260" height="64" fill="#e0b25b"/><text x="${W - 170}" y="84" font-size="34" font-weight="bold" fill="#0f2233" text-anchor="middle"${en ? "" : ` direction="rtl"`} font-family="${FONT}">${en ? `${d.cut.pct}% OFF` : `خصم ${LRI}${d.cut.pct}%${PDI}`}</text>`
      : "";
  // The old price sits at the other end of the price line, struck through.
  const was = d.cut
    ? `<text x="${en ? W - 60 : 60}" y="${PHOTO_H + 262}" font-size="40" fill="#9fb0bf" text-decoration="line-through"${en ? "" : ` direction="rtl"`} text-anchor="end" font-family="${FONT}">${esc(en ? `${d.cur} ${re.group(d.cut.was)}` : d.was(d.cut))}</text>`
    : "";
  const specs = en ? [d.specs, d.floor].filter(Boolean).join("  •  ") : d.specs;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect y="${PHOTO_H}" width="${W}" height="${H - PHOTO_H}" fill="#0f2233"/>
  <rect y="${PHOTO_H}" width="${W}" height="8" fill="#e0b25b"/>
  <rect x="40" y="40" rx="18" width="190" height="64" fill="#0f2233" fill-opacity="0.82"/>
  <text x="135" y="84" font-size="34" font-weight="bold" fill="#e0b25b" text-anchor="middle" font-family="${FONT}">#${listing.id}</text>
  ${badge}
  <text x="${side.x}" y="${PHOTO_H + 95}" font-size="62" font-weight="bold" fill="#ffffff" ${side.attrs} font-family="${FONT}">${esc(d.title)}</text>
  ${location ? `<text x="${side.x}" y="${PHOTO_H + 160}" font-size="38" fill="#b9c7d3" ${side.attrs} font-family="${FONT}">📍 ${esc(clip(location, en ? 46 : 40))}</text>` : ""}
  <text x="${side.x}" y="${PHOTO_H + 265}" font-size="${en ? 70 : 76}" font-weight="bold" fill="#e0b25b" ${side.attrs} font-family="${FONT}">${esc(d.price)}</text>
  ${was}
  ${specs ? `<text x="${side.x}" y="${PHOTO_H + 345}" font-size="${en ? 34 : 38}" fill="#ffffff" ${side.attrs} font-family="${FONT}">${esc(clip(specs, 60))}</text>` : ""}
  ${d.plan ? `<text x="${side.x}" y="${PHOTO_H + 398}" font-size="${en ? 30 : 32}" font-weight="bold" fill="#e0b25b" ${side.attrs} xml:space="preserve" font-family="${FONT}">${esc(isolateNumbers(clip(d.plan, 64)))}</text>` : ""}
  ${featureBand(d.feats, W, PHOTO_H, 66, 32, !en)}
  ${d.contact ? `<rect y="${H - 110}" width="${W}" height="110" fill="#e0b25b"/><text x="${W / 2}" y="${H - 42}" font-size="44" font-weight="bold" fill="#0f2233" text-anchor="middle"${rtlContact ? ` direction="rtl"` : ""} font-family="${FONT}">📞 ${esc(isolateNumbers(clip(d.contact, 44)))}</text>` : ""}
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

const LRI = String.fromCharCode(0x2066); // left-to-right isolate (for "11%" inside Arabic)
const PDI = String.fromCharCode(0x2069);

/** The texts every listing design shows. */
function details(listing, agent) {
  const cur = agent.currency || "جنيه";
  const status = listing.status && listing.status !== "available" ? re.STATUS_AR[listing.status].replace(/^\S+\s/, "") : "";
  return {
    title: `${listing.type || "عقار"} لل${listing.deal || "بيع"}`,
    price: listing.price ? `${re.group(listing.price)} ${cur}${listing.deal === "إيجار" ? " / شهر" : ""}` : "السعر عند التواصل",
    specs: [listing.size && `${re.group(listing.size)} م²`, listing.rooms && `${listing.rooms} غرف`, listing.baths && `${listing.baths} حمام`, listing.finishing && clip(listing.finishing, 16)].filter(Boolean).join("   •   "),
    contact: [agent.name, agent.phone].filter(Boolean).join("   "),
    status,
    cut: !status && re.discount(listing),
    was: (cut) => `${re.group(cut.was)} ${cur}`,
    // What often sells a chalet or a villa: how it's paid, when it's delivered, what it has.
    plan:
      listing.deal === "إيجار"
        ? ""
        : [listing.down && `مقدم ${re.shortAr(listing.down)}`, listing.down && listing.years && `الباقي على ${listing.years} ${listing.years > 10 || listing.years < 3 ? "سنة" : "سنين"}`, listing.delivery > new Date().getFullYear() && `استلام ${listing.delivery}`]
            .filter(Boolean)
            .join("  ·  "),
    feats: re.featuresOf(listing).slice(0, 4).join("  ·  "),
  };
}

/** The features as a band across the bottom of the photo (none: nothing). */
const featureBand = (feats, w, bottom, h, size, rtl = true) =>
  feats
    ? `<rect y="${bottom - h}" width="${w}" height="${h}" fill="#0f2233" fill-opacity="0.78"/><text x="${w / 2}" y="${bottom - h / 2 + size * 0.36}" font-size="${size}" font-weight="bold" fill="#ffffff" text-anchor="middle"${rtl ? ` direction="rtl"` : ""} xml:space="preserve" font-family="${FONT}">${esc(isolateNumbers(clip(feats, 60)))}</text>`
    : "";

/** A photo resized to fill a box, or a plain gradient with a house when there is none. */
async function tile(photoPath, w, h) {
  if (photoPath && fs.existsSync(photoPath)) return sharp(photoPath).resize(w, h, { fit: "cover", position: "attention" }).toBuffer();
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3b57"/><stop offset="1" stop-color="#3f6e8c"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="${w / 2}" y="${h / 2 + Math.round(h / 12)}" font-size="${Math.round(Math.min(w, h) / 4)}" text-anchor="middle" font-family="${FONT}">🏠</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const contactBar = (contact, w, y, h, size) =>
  contact
    ? `<rect y="${y}" width="${w}" height="${h}" fill="#e0b25b"/><text x="${w / 2}" y="${y + h / 2 + size * 0.36}" font-size="${size}" font-weight="bold" fill="#0f2233" text-anchor="middle"${/[؀-ۿ]/.test(contact) ? ` direction="rtl"` : ""} font-family="${FONT}">📞 ${esc(isolateNumbers(clip(contact, 44)))}</text>`
    : "";

const STORY_W = 1080;
const STORY_H = 1920;
const STORY_PHOTO = 1100;

/**
 * A 1080×1920 design for WhatsApp status (9:16): the first photo, then the type, area, price
 * (with a recent discount), specs, "للاستفسار أرسل: #12" and the agent's contact.
 */
async function story(listing, agent, photoPath, { lang = "ar" } = {}) {
  const en = lang === "en";
  const d = en ? english.details(listing, agent) : details(listing, agent);
  const W = STORY_W;
  const H = STORY_H;
  const P = STORY_PHOTO;
  const side = en ? { x: 70, attrs: `text-anchor="start"` } : { x: W - 70, attrs: RTL };
  const location = en ? d.location : listing.location;
  const specs = en ? [d.specs, d.floor].filter(Boolean).join("  •  ") : d.specs;
  const badge = d.status
    ? `<rect x="${W - 320}" y="60" rx="22" width="270" height="76" fill="#b3261e" fill-opacity="0.9"/><text x="${W - 185}" y="112" font-size="38" font-weight="bold" fill="#fff" text-anchor="middle" font-family="${FONT}">${esc(d.status)}</text>`
    : d.cut
      ? `<rect x="${W - 320}" y="60" rx="22" width="270" height="76" fill="#e0b25b"/><text x="${W - 185}" y="112" font-size="40" font-weight="bold" fill="#0f2233" text-anchor="middle"${en ? "" : ` direction="rtl"`} font-family="${FONT}">${en ? `${d.cut.pct}% OFF` : `خصم ${LRI}${d.cut.pct}%${PDI}`}</text>`
      : "";
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.75" stop-color="#0f2233" stop-opacity="0"/><stop offset="1" stop-color="#0f2233" stop-opacity="1"/></linearGradient></defs>
  <rect y="0" width="${W}" height="${P}" fill="url(#fade)"/>
  <rect y="${P}" width="${W}" height="${H - P}" fill="#0f2233"/>
  <rect x="50" y="60" rx="22" width="210" height="76" fill="#0f2233" fill-opacity="0.82"/>
  <text x="155" y="112" font-size="40" font-weight="bold" fill="#e0b25b" text-anchor="middle" font-family="${FONT}">#${listing.id}</text>
  ${badge}
  <text x="${side.x}" y="${P + 100}" font-size="${en ? 70 : 76}" font-weight="bold" fill="#ffffff" ${side.attrs} font-family="${FONT}">${esc(d.title)}</text>
  ${location ? `<text x="${side.x}" y="${P + 180}" font-size="${en ? 40 : 46}" fill="#b9c7d3" ${side.attrs} font-family="${FONT}">📍 ${esc(clip(location, en ? 44 : 34))}</text>` : ""}
  <text x="${side.x}" y="${P + 310}" font-size="${en ? 80 : 92}" font-weight="bold" fill="#e0b25b" ${side.attrs} font-family="${FONT}">${esc(d.price)}</text>
  ${d.cut ? `<text x="${en ? W - 70 : 70}" y="${P + 310}" font-size="46" fill="#9fb0bf" text-decoration="line-through"${en ? "" : ` direction="rtl"`} text-anchor="end" font-family="${FONT}">${esc(en ? `${d.cur} ${re.group(d.cut.was)}` : d.was(d.cut))}</text>` : ""}
  ${specs ? `<text x="${side.x}" y="${P + 405}" font-size="${en ? 38 : 44}" fill="#ffffff" ${side.attrs} font-family="${FONT}">${esc(clip(specs, 60))}</text>` : ""}
  ${d.plan ? `<text x="${side.x}" y="${P + 470}" font-size="${en ? 36 : 40}" font-weight="bold" fill="#e0b25b" ${side.attrs} xml:space="preserve" font-family="${FONT}">${esc(isolateNumbers(clip(d.plan, 60)))}</text>` : ""}
  ${featureBand(d.feats, W, P, 84, 42, !en)}
  <rect x="70" y="${P + 525}" rx="24" width="${W - 140}" height="110" fill="none" stroke="#e0b25b" stroke-width="4"/>
  <text x="${W / 2}" y="${P + 597}" font-size="50" font-weight="bold" fill="#e0b25b" text-anchor="middle"${en ? "" : ` direction="rtl"`} font-family="${FONT}">${en ? `To ask about it, send: #${listing.id} en` :`للاستفسار أرسل: ${LRI}#${listing.id}${PDI}`}</text>
  ${contactBar(d.contact, W, H - 150, 150, 50)}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: "#0f2233" } })
    .composite([
      { input: await tile(photoPath, W, P), top: 0, left: 0 },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}

const COLLAGE_PHOTOS = 900;
const GAP = 6;

/** Where each photo goes in the top 1080×900 area, for 1 to 4 photos. */
function collageLayout(n) {
  const [w, h, half, halfH] = [W, COLLAGE_PHOTOS, (W - GAP) / 2, (COLLAGE_PHOTOS - GAP) / 2];
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  if (n === 2) return [{ x: half + GAP, y: 0, w: half, h }, { x: 0, y: 0, w: half, h }];
  if (n === 3) return [{ x: half + GAP, y: 0, w: half, h }, { x: 0, y: 0, w: half, h: halfH }, { x: 0, y: halfH + GAP, w: half, h: halfH }];
  return [
    { x: half + GAP, y: 0, w: half, h: halfH },
    { x: 0, y: 0, w: half, h: halfH },
    { x: half + GAP, y: halfH + GAP, w: half, h: halfH },
    { x: 0, y: halfH + GAP, w: half, h: halfH },
  ];
}

/**
 * A 1080×1350 image with up to 4 of the listing's photos (the first one top right, reading
 * right to left), "+N" on the last when there are more, and the details panel below.
 */
async function collage(listing, agent, photoPaths) {
  const d = details(listing, agent);
  const shown = photoPaths.slice(0, 4);
  const boxes = collageLayout(shown.length).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
  const tiles = await Promise.all(boxes.map((b, i) => tile(shown[i], b.w, b.h)));
  const more = photoPaths.length - shown.length;
  const last = boxes.at(-1);
  const P = COLLAGE_PHOTOS;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${more > 0 ? `<rect x="${last.x}" y="${last.y}" width="${last.w}" height="${last.h}" fill="#0f2233" fill-opacity="0.55"/><text x="${last.x + last.w / 2}" y="${last.y + last.h / 2 + 30}" font-size="90" font-weight="bold" fill="#fff" text-anchor="middle" font-family="${FONT}">+${more}</text>` : ""}
  <rect x="40" y="40" rx="18" width="190" height="64" fill="#0f2233" fill-opacity="0.82"/>
  <text x="135" y="84" font-size="34" font-weight="bold" fill="#e0b25b" text-anchor="middle" font-family="${FONT}">#${listing.id}</text>
  <rect y="${P}" width="${W}" height="8" fill="#e0b25b"/>
  <text x="${W - 60}" y="${P + 85}" font-size="56" font-weight="bold" fill="#ffffff" ${RTL} font-family="${FONT}">${esc(d.title)}${listing.location ? ` — ${esc(clip(listing.location, 26))}` : ""}</text>
  <text x="${W - 60}" y="${P + 180}" font-size="72" font-weight="bold" fill="#e0b25b" ${RTL} font-family="${FONT}">${esc(d.price)}</text>
  ${d.cut ? `<text x="60" y="${P + 180}" font-size="40" fill="#9fb0bf" text-decoration="line-through" direction="rtl" text-anchor="end" font-family="${FONT}">${esc(d.was(d.cut))}</text>` : ""}
  ${d.specs ? `<text x="${W - 60}" y="${P + 255}" font-size="36" fill="#ffffff" ${RTL} font-family="${FONT}">${esc(d.specs)}</text>` : ""}
  ${d.plan ? `<text x="${W - 60}" y="${P + 312}" font-size="32" font-weight="bold" fill="#e0b25b" ${RTL} xml:space="preserve" font-family="${FONT}">${esc(isolateNumbers(clip(d.plan, 64)))}</text>` : ""}
  ${featureBand(d.feats, W, P, 62, 30)}
  ${contactBar(d.contact, W, H - 100, 100, 42)}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: "#0f2233" } })
    .composite([...tiles.map((input, i) => ({ input, top: boxes[i].y, left: boxes[i].x })), { input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { flyer, story, collage, collageLayout, details, watermark, toListingJpeg, esc, isolateNumbers, clip, FONT, RTL };
