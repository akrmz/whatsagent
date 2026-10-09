"use strict";

const sharp = require("sharp");
const re = require("./realestate");
const rentals = require("./rentals");
const { esc, isolateNumbers, clip, FONT, RTL } = require("./reimages");

/**
 * A rent receipt (.rental receipt): an image for a payment that was recorded with
 * ".rental paid" — never for one that wasn't, so it can't be made for money not received.
 * The number is R<rental>-<YYYYMM>, so the same month always gets the same number.
 */

const W = 1080;
const H = 1350;

// Latin codes inside Arabic lines ("R1-202610", "#12") keep their order when isolated.
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const isolateCodes = (s) => String(s).replace(/R\d+-\d{6}|#\d+/g, (m) => `${LRI}${m}${PDI}`);

const text = (x, y, size, body, { fill = "#0f2233", bold = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}"${bold ? ` font-weight="bold"` : ""} fill="${fill}" ${RTL} font-family="${FONT}">${esc(isolateNumbers(isolateCodes(body)))}</text>`;

const number = (r, mk) => `R${r.id}-${mk.replace("-", "")}`;

/** The facts on the receipt (also used for its caption). */
function facts(state, r, mk, timeZone) {
  const p = r.payments?.[mk];
  if (!p) return null;
  const cur = re.agent(state).currency;
  const received = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date(p.at));
  return {
    no: number(r, mk),
    tenant: r.tenant,
    amount: re.money(p.amount, cur),
    short: p.amount < r.rent ? re.money(r.rent - p.amount, cur) : null,
    month: rentals.arMonth(mk),
    unit: rentals.unitName(state, r),
    received,
  };
}

async function render(state, r, mk, timeZone) {
  const f = facts(state, r, mk, timeZone);
  if (!f) return null;
  const a = re.agent(state);
  const issuer = [a.company, a.name].filter(Boolean).join(" — ") || "المؤجر / الوكيل";
  const rows = [
    ["استلمنا من", clip(f.tenant, 40)],
    ["مبلغ", f.amount],
    ["قيمة إيجار شهر", f.month],
    ["الوحدة", clip(f.unit, 44)],
    ["تاريخ الاستلام", f.received],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 430 + i * 120;
      return [
        i % 2 === 0 ? `<rect x="60" y="${y - 70}" width="${W - 120}" height="110" rx="14" fill="#f1f4f7"/>` : "",
        text(W - 100, y - 18, 30, label, { fill: "#5a6b7a" }),
        text(W - 100, y + 26, label === "مبلغ" ? 46 : 38, value, { bold: true, fill: label === "مبلغ" ? "#1b7a43" : "#0f2233" }),
      ].join("\n");
    })
    .join("\n");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="230" fill="#0f2233"/>
  ${text(W - 60, 110, 60, "إيصال استلام إيجار", { fill: "#ffffff", bold: true })}
  ${text(W - 60, 180, 32, `رقم الإيصال: ${f.no}`, { fill: "#e0b25b" })}
  ${text(W - 60, 300, 30, clip(issuer, 50), { fill: "#5a6b7a" })}
  ${body}
  ${f.short ? text(W - 100, 1050, 32, `دفعة جزئية — المتبقي من إيجار الشهر: ${f.short}`, { fill: "#b3261e", bold: true }) : ""}
  ${text(W - 100, 1140, 32, "توقيع المستلم: ____________________")}
  <rect y="${H - 110}" width="${W}" height="110" fill="#0f2233"/>
  ${re.contactLine(a) ? text(W - 60, H - 45, 30, clip(re.contactLine(a), 60), { fill: "#ffffff" }) : ""}
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** The caption: the same facts as text (searchable in the chat). */
function caption(state, r, mk, timeZone) {
  const f = facts(state, r, mk, timeZone);
  return f && `🧾 إيصال استلام إيجار (${f.no})\nاستلمنا من ${f.tenant} مبلغ ${f.amount} قيمة إيجار شهر ${f.month}\nالوحدة: ${f.unit}\nتاريخ الاستلام: ${f.received}${f.short ? `\n⚠️ دفعة جزئية — المتبقي ${f.short}` : ""}`;
}

/** The latest paid month, or null. */
const lastPaid = (r) => Object.keys(r.payments || {}).sort().at(-1) || null;

module.exports = { render, caption, facts, lastPaid, number };
