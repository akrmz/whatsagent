"use strict";

const sharp = require("sharp");
const re = require("./realestate");
const market = require("./market");
const { esc, isolateNumbers, clip, FONT, RTL } = require("./reimages");

/**
 * ".market image": the price per m² by area as a picture to post (1080×1350, the 4:5 size of
 * Facebook/Instagram posts; also fine on WhatsApp status): a bar for each area, the median and
 * how many listings it comes from, and the agent's contact. Sale and rent are never mixed.
 */

const W = 1080;
const H = 1350;
const MAX_BARS = 8;
const MIN_PRICED = 2; // one listing isn't "the market"

const text = (x, y, size, body, { fill = "#0f2233", bold = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}"${bold ? ` font-weight="bold"` : ""} fill="${fill}" ${RTL} font-family="${FONT}">${esc(isolateNumbers(body))}</text>`;

const PLURAL = { شقة: "الشقق", فيلا: "الفيلات", شاليه: "الشاليهات", دوبلكس: "الدوبلكس", بنتهاوس: "البنتهاوس", "تاون هاوس": "التاون هاوس", "توين هاوس": "التوين هاوس", استوديو: "الاستوديوهات", محل: "المحلات", مكتب: "المكاتب", عيادة: "العيادات", أرض: "الأراضي", عمارة: "العمارات" };
const MAX_TYPES = 4;
const RENT = /(?<![\p{L}])(?:إيجار|ايجار|للإيجار|للايجار|rent)(?![\p{L}])/iu;

/**
 * One chart per unit type (apartments, villas and chalets are different markets, in different
 * areas): for a search, sale listings unless it says rent, each type's areas with at least 2
 * priced listings — the 8 with the most listings, drawn highest price first. Types with the most
 * listings first, at most 4. @returns {{ rent, charts: [{ type, bars, total }] }}
 */
function charts(state, query) {
  const rent = RENT.test(query || "");
  const deal = rent ? "إيجار" : "بيع";
  const { list } = re.search(state, `${query || ""} all`);
  const byType = new Map();
  for (const l of list) {
    if ((l.deal || "بيع") !== deal || market.ppm(l) === null || !market.areaOf(l.location)) continue;
    const t = l.type || "عقار";
    if (!byType.has(t)) byType.set(t, new Map());
    const areas = byType.get(t);
    const area = market.areaOf(l.location);
    if (!areas.has(area)) areas.set(area, []);
    areas.get(area).push(l);
  }
  const out = [];
  for (const [type, areas] of byType) {
    const groups = [...areas]
      .map(([label, items]) => ({ label, ...market.summarize(items) }))
      .filter((g) => g.priced >= MIN_PRICED)
      .sort((a, b) => b.priced - a.priced)
      .slice(0, MAX_BARS);
    if (!groups.length) continue;
    out.push({
      type,
      total: groups.reduce((n, g) => n + g.priced, 0),
      bars: groups.map((g) => ({ label: g.label, median: Math.round(g.median), count: g.priced })).sort((x, y) => y.median - x.median),
    });
  }
  return { rent, charts: out.sort((a, b) => b.total - a.total || a.type.localeCompare(b.type, "ar")).slice(0, MAX_TYPES) };
}

/** "عرضين", "3 عروض", "12 عرض" */
const offers = (n) => (n === 1 ? "عرض واحد" : n === 2 ? "عرضين" : n <= 10 ? `${n} عروض` : `${n} عرض`);

const monthLabel = (timeZone, now) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone, month: "long", year: "numeric" }).format(new Date(now));
const NBSP = String.fromCharCode(0xa0); // a space SVG keeps (between an area and its count)
const titleOf = (type, rent) => `${rent ? "إيجار المتر شهرياً" : "أسعار المتر"} — ${PLURAL[type] || type}`;

/** One type's chart (JPEG). */
function draw(state, chart, rent, timeZone, now) {
  const a = re.agent(state);
  const cur = a.currency || "جنيه";
  const max = Math.max(...chart.bars.map((x) => x.median));
  // Few areas: taller rows, and the block centred between the heading and the footer.
  const avail = H - 210 - 300;
  const row = Math.min(150, Math.floor(avail / chart.bars.length));
  const top = 300 + Math.max(0, Math.floor((avail - row * chart.bars.length) / 2));
  const barMax = W - 140;
  const rows = chart.bars
    .map((x, i) => {
      const y = top + i * row;
      const w = Math.max(260, Math.round((x.median / max) * barMax)); // room for the figure inside
      return [
        // The count follows the area in the same line (a tspan keeps the right-to-left order).
        `<text x="${W - 70}" y="${y}" font-size="32" font-weight="bold" fill="#0f2233" xml:space="preserve" ${RTL} font-family="${FONT}">${esc(isolateNumbers(clip(x.label, 30)))}<tspan font-size="24" font-weight="normal" fill="#5a6b7a">${NBSP}${NBSP}(${esc(isolateNumbers(offers(x.count)))})</tspan></text>`,
        `<rect x="${W - 70 - w}" y="${y + 14}" width="${w}" height="46" rx="10" fill="#2f6f9f"/>`,
        text(W - 86, y + 47, 28, `${re.group(x.median)} ${cur}${rent ? " شهرياً" : ""}`, { fill: "#ffffff", bold: true }),
      ].join("\n");
    })
    .join("\n");
  const contact = re.contactLine(a);
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="220" fill="#0f2233"/>
  ${text(W - 60, 105, 56, titleOf(chart.type, rent), { fill: "#ffffff", bold: true })}
  ${text(W - 60, 172, 32, monthLabel(timeZone, now), { fill: "#e0b25b" })}
  ${text(W - 70, 262, 24, "متوسط سعر المتر حسب المنطقة", { fill: "#5a6b7a" })}
  ${rows}
  ${text(W - 70, H - 150, 22, `من ${offers(chart.total)} في الكتالوج — للاسترشاد، مش تقييم رسمي`, { fill: "#5a6b7a" })}
  <rect y="${H - 110}" width="${W}" height="110" fill="#0f2233"/>
  ${contact ? text(W - 60, H - 45, 30, clip(contact, 60), { fill: "#ffffff" }) : ""}
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** The same figures as text, for the caption. */
function captionOf(state, chart, rent, timeZone, now) {
  const cur = re.agent(state).currency || "جنيه";
  return [`📊 ${titleOf(chart.type, rent)} — ${monthLabel(timeZone, now)}`, ...chart.bars.map((x) => `▫️ ${x.label}: ${re.group(x.median)} ${cur}${rent ? " شهرياً" : ""} (${offers(x.count)})`), "", "للاسترشاد من عروض الكتالوج، مش تقييم رسمي."].join("\n");
}

/** One picture per unit type: [{ type, image, caption }] (empty when no area has 2 priced listings). */
async function render(state, query, timeZone, now = Date.now()) {
  const { rent, charts: list } = charts(state, query);
  const out = [];
  for (const chart of list) out.push({ type: chart.type, image: await draw(state, chart, rent, timeZone, now), caption: captionOf(state, chart, rent, timeZone, now) });
  return out;
}

module.exports = { render, charts, offers, MIN_PRICED };

