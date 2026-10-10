"use strict";

const re = require("./realestate");
const leads = require("./leads");
const bytype = require("./bytype");

/**
 * The week in numbers (.weekly, and the morning summary on Saturdays): the last 7 days against
 * the 7 before. Counted from what is already kept with dates: clients' creation and history
 * notes (sends, replies, viewings booked and their outcomes), deals, listings and price history.
 */

const DAY = 24 * 3600 * 1000;

/** Counts for [from, to). */
function counts(state, from, to) {
  const inside = (t) => t >= from && t < to;
  const c = { clients: 0, bySource: {}, sent: 0, replies: 0, viewings: 0, outcomes: { liked: 0, thinking: 0, no: 0, noshow: 0 }, deals: 0, commission: 0, listings: 0, cuts: 0, byType: {} };
  const ofType = (t) => (c.byType[t] ||= { clients: 0, deals: 0 });
  for (const l of leads.all(state)) {
    if (inside(l.created)) {
      c.clients++;
      const src = l.source || "غير محدد";
      c.bySource[src] = (c.bySource[src] || 0) + 1;
      if (l.type) ofType(l.type).clients++;
    }
    for (const h of l.history || []) {
      if (!inside(h.at)) continue;
      const t = String(h.text || "");
      if (/^أُرسل(?:ت)? له/u.test(t)) c.sent++;
      else if (/^ردّ/u.test(t)) c.replies++;
      else if (/^موعد معاينة/u.test(t)) c.viewings++;
      else if (/^نتيجة معاينة/u.test(t)) {
        if (t.includes("👍")) c.outcomes.liked++;
        else if (t.includes("🤔")) c.outcomes.thinking++;
        else if (t.includes("👎")) c.outcomes.no++;
        else if (t.includes("🚫")) c.outcomes.noshow++;
      }
    }
    for (const d of l.deals || []) {
      if (!inside(d.at)) continue;
      c.deals++;
      c.commission += d.commission || 0;
      ofType(bytype.dealType(state, { deal: d, lead: l })).deals++;
    }
  }
  for (const l of re.all(state)) {
    if (inside(l.created)) c.listings++;
    // priceHistory keeps the price *before* each change; the change was a cut if what came next is lower.
    const hist = l.priceHistory || [];
    hist.forEach((h, i) => {
      const next = hist[i + 1]?.price ?? l.price;
      if (inside(h.at) && next < h.price) c.cuts++;
    });
  }
  return c;
}

const change = (now, before) => (before === now ? "" : before ? ` (${now > before ? "+" : ""}${Math.round((now / before - 1) * 100)}%)` : now ? " (جديد)" : "");
const dayName = (t, timeZone) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", timeZone }).format(new Date(t));

/** The weekly summary text. */
function build(state, timeZone, now = Date.now()) {
  const w = counts(state, now - 7 * DAY, now);
  const p = counts(state, now - 14 * DAY, now - 7 * DAY);
  const cur = re.agent(state).currency;
  const src = Object.entries(w.bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ");
  const o = w.outcomes;
  // Apartments, chalets and villas apart: new clients wanting each, and deals.
  const types = Object.entries(w.byType)
    .sort((a, b) => b[1].clients + b[1].deals - (a[1].clients + a[1].deals))
    .map(([t, x]) => `${t}: ${[x.clients && `${x.clients} عميل`, x.deals && `${x.deals} صفقة`].filter(Boolean).join(" · ")}`)
    .join(" | ");
  const outcomes = [o.liked && `👍 ${o.liked}`, o.thinking && `🤔 ${o.thinking}`, o.no && `👎 ${o.no}`, o.noshow && `🚫 ${o.noshow}`].filter(Boolean).join(" · ");
  return [
    `📊 *ملخص الأسبوع* (${dayName(now - 7 * DAY, timeZone)} – ${dayName(now - DAY, timeZone)})`,
    `👥 عملاء جدد: ${w.clients}${change(w.clients, p.clients)}${src ? ` — ${src}` : ""}`,
    `📤 رسائل للعملاء: ${w.sent}${change(w.sent, p.sent)} · 💬 ردود: ${w.replies}${change(w.replies, p.replies)}`,
    `👀 معاينات اتحجزت: ${w.viewings}${change(w.viewings, p.viewings)}${outcomes ? ` — ${outcomes}` : ""}`,
    `✅ صفقات: ${w.deals}${change(w.deals, p.deals)}${w.commission ? ` · 🧾 عمولة ${re.money(w.commission, cur)}` : ""}`,
    `🏠 عقارات جديدة: ${w.listings} · 📉 تخفيضات: ${w.cuts}`,
    types && `🏷️ حسب النوع: ${types}`,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = { counts, build };
