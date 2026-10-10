"use strict";

const re = require("./realestate");
const market = require("./market");

/**
 * Units that aren't selling (.listings slow): available listings on the market for a while, with
 * their funnel (reached → asked → viewed → what viewers thought), the price against similar
 * listings, and the one next step that fits what the numbers say. Grouped by unit type, since an
 * apartment, a chalet and a villa sell differently. From the counters the bot already keeps.
 */

const DAY = 86400000;
const MIN_DAYS = 30;
const LOW_REACH = 10; // views + sends + posts below this: barely marketed
const SEEN_A_LOT = 20; // reached this many and nobody asked: the price or the photos
const ABOVE_MARKET = 10; // % per m² above similar listings

const times = (n) => `${n} ${n >= 3 && n <= 10 ? "مرات" : "مرة"}`;

/** The funnel of one listing. */
function funnel(l) {
  const s = l.stats || {};
  const fb = l.feedback || [];
  const count = (k) => fb.filter((f) => f.result === k).length;
  return {
    reached: (s.views || 0) + (s.sent || 0) + (s.posted || 0),
    views: s.views || 0,
    sent: s.sent || 0,
    asked: s.inquiries || 0,
    viewings: Math.max(s.booked || 0, fb.length),
    liked: count("liked") + count("thinking"),
    no: count("no"),
    noshow: count("noshow"),
  };
}

/**
 * What to do about it, the first that applies: { key, label, fix }. `vs`: % per m² against
 * similar listings, or null without enough of them.
 */
function advice(l, f, vs, p = ".") {
  const id = l.id;
  if (!(l.photos > 0)) return { key: "photos", label: "📷 من غير صور: أغلب العملاء مش بيسألوا عن عقار من غير صورة", fix: `${p}listing photo ${id} (على صورة)` };
  if (f.liked) return { key: "warm", label: `🤝 فيه ${f.liked} مهتم بعد المعاينة: تابعهم قبل ما يبردوا`, fix: `${p}listing who ${id}` };
  if (vs !== null && vs >= ABOVE_MARKET && (f.reached >= LOW_REACH || f.viewings)) return { key: "price", label: `💰 سعر المتر أعلى من المشابه بـ ${vs}%: كلم المالك في السعر بالأرقام`, fix: `${p}listing report ${id} send · ${p}market ${id}` };
  if (f.reached < LOW_REACH) return { key: "reach", label: `📣 قليل الظهور: اتشاف واتبعت ${times(f.reached)} بس`, fix: `${p}blast ${id} · ${p}statuspost ${id}` };
  if (f.no >= 2 && f.no >= f.viewings / 2) return { key: "disliked", label: `👎 ${f.no} من ${f.viewings} عاينوا وما عجبهمش: شوف قالوا إيه`, fix: `${p}listing report ${id}` };
  if (f.asked >= 3 && !f.viewings) return { key: "noviewing", label: `💬 ${f.asked} سألوا ومحدش عاين: اعرض عليهم ميعاد`, fix: `${p}listing who ${id}` };
  if (f.noshow >= 2) return { key: "noshow", label: `🚫 ${f.noshow} حجزوا وما جوش: أكّد المعاينة قبلها بيوم`, fix: `${p}viewings` };
  if (f.reached >= SEEN_A_LOT && !f.asked) return { key: "silent", label: `🤐 اتشاف ${times(f.reached)} ومحدش سأل: السعر أو الصور أو الوصف`, fix: `${p}market ${id} · ${p}listing ${id}` };
  if (vs !== null && vs >= ABOVE_MARKET) return { key: "price", label: `💰 سعر المتر أعلى من المشابه بـ ${vs}%`, fix: `${p}market ${id}` };
  return { key: "push", label: "🔁 محتاج دفعة: صورة جديدة أو بوست أو تخفيض بسيط", fix: `${p}statuspost ${id} · ${p}flyer ${id}` };
}

/**
 * Available listings older than minDays, the oldest first, by unit type:
 * @returns {{ groups: [{ type, items: [{ listing, days, funnel, vs, advice }] }], total, available }}
 */
function slow(state, { minDays = MIN_DAYS, p = "." } = {}, now = Date.now()) {
  const available = re.all(state).filter((l) => l.status === "available");
  const items = available
    .map((l) => ({ listing: l, days: Math.floor((now - (l.back?.at || l.created)) / DAY) }))
    .filter((x) => x.days >= minDays)
    .map((x) => {
      const f = funnel(x.listing);
      const m = x.listing.deal === "إيجار" ? null : market.compareToMarket(state, x.listing);
      const vs = m && m.stats ? m.diffPct : null;
      return { ...x, funnel: f, vs, advice: advice(x.listing, f, vs, p) };
    })
    .sort((a, b) => b.days - a.days || a.listing.id - b.listing.id);
  const byType = new Map();
  for (const it of items) {
    const t = it.listing.type || "عقار";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(it);
  }
  const groups = [...byType].map(([type, list]) => ({ type, items: list })).sort((a, b) => b.items.length - a.items.length);
  return { groups, total: items.length, available: available.length };
}

/** "👀 120 · 📣 30 · 💬 4 · 🏠 2 (👎 2) · 📈 +18%" */
function funnelLine(f, vs) {
  const results = [f.liked && `👍 ${f.liked}`, f.no && `👎 ${f.no}`, f.noshow && `🚫 ${f.noshow}`].filter(Boolean).join(" ");
  return [
    `👀 ${f.views}`,
    f.sent && `📣 ${f.sent}`,
    `💬 ${f.asked}`,
    `🏠 ${f.viewings}${results ? ` (${results})` : ""}`,
    vs !== null && `📈 ${vs > 0 ? "+" : ""}${vs}%`,
  ]
    .filter(Boolean)
    .join(" · ");
}

module.exports = { slow, funnel, advice, funnelLine, MIN_DAYS };
