"use strict";

const sharp = require("sharp");
const re = require("./realestate");
const { esc, isolateNumbers, clip, FONT, RTL } = require("./reimages");
const { zoneNow } = require("./gcschedule");

/**
 * A price offer for a client (.offer): the listing, the price and, with a payment plan, the
 * schedule of instalments with their dates — drawn as A4-shaped pages for a PDF.
 */

const W = 1080;
const H = 1528; // A4 proportions
const VALID_DAYS = 7;
const ROW = 46; // schedule row height
const MORE_ROWS = 26; // rows on each page after the first (the first page takes what fits under the summary)

/** "2026-10-08" plus k months (the day clamped to the month's length: 31 Jan + 1 month = 28/29 Feb). */
function addMonths(day, k) {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + k, Math.min(d, last)));
}
const arDate = (date) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);

/**
 * The payments of a plan (from recalc.installments): the down payment on signing, then each
 * instalment every 12/perYear months. Amounts are whole numbers; the last instalment takes
 * the rounding so the total is exactly the price.
 */
function schedule(plan, timeZone, now = Date.now()) {
  const today = zoneNow(timeZone, now).day;
  const step = 12 / plan.perYear;
  const each = Math.round(plan.each);
  const rows = [{ n: 0, label: "المقدم — عند التعاقد", date: arDate(addMonths(today, 0)), amount: Math.round(plan.down) }];
  for (let k = 1; k <= plan.count; k++) rows.push({ n: k, label: `القسط ${k}`, date: arDate(addMonths(today, k * step)), amount: each });
  rows.at(-1).amount = Math.round(plan.price) - rows.slice(0, -1).reduce((s, r) => s + r.amount, 0);
  return rows;
}

const text = (x, y, size, body, { fill = "#0f2233", bold = false, rtl = true, anchor } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}"${bold ? ` font-weight="bold"` : ""} fill="${fill}" ${rtl ? RTL : `text-anchor="${anchor || "start"}"`} font-family="${FONT}">${esc(isolateNumbers(body))}</text>`;

const page = (body, n, total, footer) =>
  sharp(
    Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  ${body}
  <rect y="${H - 90}" width="${W}" height="90" fill="#0f2233"/>
  ${footer ? text(W - 50, H - 36, 30, footer, { fill: "#e0b25b", bold: true }) : ""}
  <text x="50" y="${H - 36}" font-size="26" fill="#b9c7d3" font-family="${FONT}">${n}/${total}</text>
</svg>`),
  )
    .jpeg({ quality: 90 })
    .toBuffer();

function tableRows(rows, y0, cur) {
  const out = [
    `<rect x="40" y="${y0 - 44}" width="${W - 80}" height="60" fill="#0f2233"/>`,
    text(W - 60, y0, 30, "الدفعة", { fill: "#fff", bold: true }),
    text(W - 420, y0, 30, "الموعد", { fill: "#fff", bold: true }),
    text(370, y0, 30, "المبلغ", { fill: "#fff", bold: true }),
  ];
  rows.forEach((r, i) => {
    const y = y0 + 52 + i * ROW;
    if (i % 2 === 0) out.push(`<rect x="40" y="${y - 32}" width="${W - 80}" height="${ROW}" fill="#f1f4f7"/>`);
    out.push(text(W - 60, y, 28, r.label, { bold: r.n === 0 }), text(W - 420, y, 28, r.date), text(370, y, 28, `${re.group(r.amount)} ${cur}`, { bold: r.n === 0 }));
  });
  return out.join("\n");
}

/**
 * The offer pages (JPEG buffers).
 * @param {object} o { listing, agent, client?, plan?, timeZone, now? }
 */
async function render({ listing, agent, client, plan, timeZone, now = Date.now() }) {
  const cur = agent.currency || "جنيه";
  const money = (n) => `${re.group(n)} ${cur}`;
  const today = zoneNow(timeZone, now).day;
  const rows = plan ? schedule(plan, timeZone, now) : [];
  const footer = [agent.name, agent.phone, agent.company].filter(Boolean).join("  ·  ");

  const specs = [listing.size && `${re.group(listing.size)} م²`, listing.rooms && `${listing.rooms} غرف`, listing.baths && `${listing.baths} حمام`, listing.floor && `الدور ${listing.floor}`, listing.finishing].filter(Boolean).join("  ·  ");
  const summary = plan
    ? [
        ["السعر", money(plan.price)],
        [`المقدم (${+plan.downPct.toFixed(1)}%)`, money(Math.round(plan.down))],
        ["الباقي", `${money(Math.round(plan.remaining))} على ${plan.years} سنوات`],
        [`القسط ال${plan.freq}`, `${money(Math.round(plan.each))} × ${plan.count}`],
        ...(plan.maintenance ? [[`وديعة الصيانة (${plan.maintPct}%)`, money(Math.round(plan.maintenance))]] : []),
      ]
    : [["السعر", `${money(listing.price)}${listing.deal === "إيجار" ? " شهرياً" : " — كاش"}`]];

  const first = [
    `<rect width="${W}" height="190" fill="#0f2233"/><rect y="190" width="${W}" height="8" fill="#e0b25b"/>`,
    text(W - 60, 95, 64, "عرض سعر", { fill: "#fff", bold: true }),
    agent.company || agent.name ? text(W - 60, 155, 32, clip(agent.company || agent.name, 50), { fill: "#e0b25b" }) : "",
    text(60, 95, 30, `#${listing.id}`, { fill: "#e0b25b", bold: true, rtl: false }),
  ];
  let y = 270;
  if (client?.name) {
    first.push(text(W - 60, y, 36, `مقدم إلى: ${clip(client.name, 40)}`, { bold: true }));
    y += 56;
  }
  first.push(text(W - 60, y, 28, `التاريخ: ${arDate(addMonths(today, 0))}  ·  العرض ساري حتى ${arDate(new Date(addMonths(today, 0).getTime() + VALID_DAYS * 86400000))}`, { fill: "#55657a" }));
  y += 80;
  first.push(`<rect x="40" y="${y - 50}" width="${W - 80}" height="${specs ? 150 : 100}" rx="16" fill="#f6efe1"/>`);
  first.push(text(W - 70, y, 40, `${listing.type || "عقار"} لل${listing.deal || "بيع"}${listing.location ? ` — ${clip(listing.location, 34)}` : ""}`, { bold: true }));
  if (specs) first.push(text(W - 70, y + 60, 30, clip(specs, 60), { fill: "#55657a" }));
  y += specs ? 170 : 120;
  for (const [k, v] of summary) {
    first.push(text(W - 60, y, 34, k, { fill: "#55657a" }), text(W - 470, y, 36, v, { bold: true }));
    y += 58;
  }
  y += 50;
  // As many rows as fit above the note at the bottom; the rest go on the next pages.
  const fits = Math.max(0, Math.floor((H - 211 - y) / ROW) + 1);
  const pagesOfRows = [rows.slice(0, fits)];
  for (let i = fits; i < rows.length; i += MORE_ROWS) pagesOfRows.push(rows.slice(i, i + MORE_ROWS));
  const total = pagesOfRows.length;
  if (rows.length) first.push(tableRows(pagesOfRows[0], y, cur));
  first.push(text(W - 60, H - 120, 24, "الأرقام استرشادية وتخضع للتعاقد النهائي.", { fill: "#8a96a3" }));

  const pages = [await page(first.join("\n"), 1, total, footer)];
  for (let p = 1; p < total; p++) {
    const body = [
      `<rect width="${W}" height="110" fill="#0f2233"/>`,
      text(W - 60, 72, 40, `عرض سعر #${listing.id} — جدول السداد (تابع)`, { fill: "#fff", bold: true }),
      tableRows(pagesOfRows[p], 200, cur),
    ];
    pages.push(await page(body.join("\n"), p + 1, total, footer));
  }
  return pages;
}

module.exports = { render, schedule, addMonths, arDate, W, H, VALID_DAYS };
