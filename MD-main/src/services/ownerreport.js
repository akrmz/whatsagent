"use strict";

const re = require("./realestate");
const market = require("./market");
const { RESULTS } = require("./viewings");
const { redactPhones } = require("./phones");

/**
 * The marketing report a listing's owner gets (.listing report 12 [send]): how long it has
 * been offered, how many clients it went to, views and inquiries, viewings and what the
 * viewers said, and how its price per m² compares with similar listings. Counts only: no
 * client names or numbers (viewing notes are the agent's words, with phone numbers masked).
 */

const DAY = 86400000;
const RESEND_AFTER = 20 * 3600 * 1000; // one report per listing a day
const MAX_NOTES = 5;

/** "أعلى من متوسط 8 عقارات مشابهة بـ 12%" — sale listings with enough similar ones only. */
function marketLine(state, l, cur) {
  if (l.deal === "إيجار") return null;
  const m = market.compareToMarket(state, l);
  if (!m.stats) return null;
  const vs =
    m.diffPct >= 10 ? `أعلى من المتوسط بـ ${m.diffPct}%` : m.diffPct <= -10 ? `أقل من المتوسط بـ ${-m.diffPct}%` : "في حدود المتوسط";
  return `📈 سعر المتر ${re.money(Math.round(m.ppm), cur)} — ${vs} (مقارنة بـ ${m.similar.length} عقار مشابه في المنطقة)`;
}

function text(state, l, now = Date.now()) {
  const a = re.agent(state);
  const cur = a.currency;
  const s = l.stats || {};
  const fb = l.feedback || [];
  const days = Math.floor((now - l.created) / DAY);
  const was = l.priceHistory?.at(-1);
  const price = l.price
    ? `💰 السعر المعروض: ${re.money(l.price, cur)}${l.deal === "إيجار" ? " شهرياً" : ""}${was && was.price > l.price ? ` (بعد التخفيض من ${re.money(was.price, cur)})` : ""}`
    : null;

  const viewings = Math.max(s.booked || 0, fb.length);
  const tally = Object.keys(RESULTS)
    .map((k) => [RESULTS[k].ar, fb.filter((f) => f.result === k).length])
    .filter(([, n]) => n)
    .map(([ar, n]) => `${ar} ${n}`)
    .join(" · ");
  const notes = fb
    .filter((f) => f.note)
    .slice(-MAX_NOTES)
    .reverse()
    .map((f) => `• ${redactPhones(f.note).slice(0, 150)}`);

  const activity = [
    s.sent && `📣 اتبعت لـ ${s.sent} عميل مناسب`,
    (s.views || s.inquiries) && `👀 ${[s.views && `${s.views} مشاهدة`, s.inquiries && `${s.inquiries} استفسار`].filter(Boolean).join(" · ")}`,
    s.posted && `📱 اتنشر ${s.posted} مرة (حالة واتساب والمنشورات)`,
    viewings && `🏠 المعاينات: ${viewings}${tally ? `\n   ${tally}` : ""}`,
  ].filter(Boolean);

  const what = `${l.type || "العقار"}${l.location ? ` في ${l.location}` : ""} (#${l.id})`;
  return [
    l.owner?.name ? `أهلاً ${l.owner.name} 👋` : "أهلاً 👋",
    `📊 تقرير تسويق ${what} لحد النهارده:`,
    "",
    l.status !== "available" ? `🔖 الحالة: ${re.STATUS_AR[l.status] || l.status}` : null,
    price,
    days >= 1 ? `📅 معروض من ${days} يوم` : "📅 معروض من النهارده",
    "",
    ...(activity.length ? activity : ["📣 لسه بادئين التسويق، وهنبعتلك التحديثات أول بأول."]),
    notes.length ? `\n💬 آراء اللي عاينوا:\n${notes.join("\n")}` : null,
    marketLine(state, l, cur) ? `\n${marketLine(state, l, cur)}` : null,
    "",
    "لو فيه أي تغيير في السعر أو الحالة ابعتهولي هنا 🙏",
    re.contactLine(a) || null,
  ]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Sends the report to the owner. Throws (as a message for the agent) when it can't be sent. */
async function send(ctx, l, now = Date.now()) {
  if (!l.owner?.phone) throw new Error(`#${l.id} has no owner number`);
  if (l.reportedAt && now - l.reportedAt < RESEND_AFTER) return false;
  await ctx.sock.sendMessage(`${l.owner.phone}@s.whatsapp.net`, { text: text(ctx.state, l, now) });
  re.update(ctx.state, l.id, { reportedAt: now }, l.updated); // a report isn't an update of the listing
  return true;
}

module.exports = { text, send, RESEND_AFTER };
