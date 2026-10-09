"use strict";

const re = require("./realestate");
const market = require("./market");
const { RESULTS } = require("./viewings");
const { redactPhones } = require("./phones");

/**
 * The marketing report a listing's owner gets (.listing report 12 [send], and weekly with
 * ".agent ownerreports on"): how long it has been offered, how many clients it went to, views
 * and inquiries, viewings and what the viewers said, and how its price per m² compares with
 * similar listings. Counts only: no client names or numbers (viewing notes are the agent's
 * words, with phone numbers masked). An owner who sends "وقف التقارير" gets no more reports.
 *   DATA_DIR/owner-prefs.json { noReports: { [phone]: since } }
 */

const DAY = 86400000;
const RESEND_AFTER = 20 * 3600 * 1000; // one report per listing a day, when sent by hand
const WEEKLY_EVERY = 6 * DAY; // the weekly ones skip a listing reported in the last 6 days
const WEEKLY_MIN_AGE = 3 * DAY; // and listings added in the last 3 days (nothing to say yet)
const WEEKLY_MAX = 30;
const MAX_NOTES = 5;
const STOP_LINE = "لو مش حابب توصلك التقارير دي ابعت: وقف التقارير";

const prefs = (state) => state.store("owner-prefs", { noReports: {} });
const reportsOff = (state, phone) => Boolean(prefs(state).data.noReports[phone]);

function setReports(state, phone, on, now = Date.now()) {
  prefs(state).update((d) => {
    if (on) delete d.noReports[phone];
    else d.noReports[phone] = now;
  });
}

const REPORTS_STOP = /^(?:وقف|توقف|ايقاف|إيقاف|الغاء|إلغاء)\s*(?:ال)?تقارير$/;
const REPORTS_START = /^(?:اشتراك|اشترك|تشغيل)\s*(?:ال)?تقارير$/;
/** "وقف التقارير" → "stop", "اشتراك التقارير" → "start", else null. */
function reportsWord(text) {
  const w = String(text || "").trim().replace(/[.!؟?]+$/, "");
  return REPORTS_STOP.test(w) ? "stop" : REPORTS_START.test(w) ? "start" : null;
}

/**
 * An owner's "وقف التقارير" / "اشتراك التقارير" (private chat). Only numbers that own a
 * listing are answered. @returns {Promise<boolean>} true if it was handled
 */
async function handleWord(ctx, phone, now = Date.now()) {
  const word = reportsWord(ctx.body);
  if (!word || !re.all(ctx.state).some((l) => l.owner?.phone === phone)) return false;
  const stop = word === "stop";
  if (reportsOff(ctx.state, phone) === stop) return true; // nothing changes: no reply
  setReports(ctx.state, phone, !stop, now);
  await ctx.reply(stop ? "✅ تمام، مش هتوصلك تقارير تاني. لو حبيت ترجعها ابعت: اشتراك التقارير" : "✅ تمام، هتوصلك تقارير التسويق تاني. لإيقافها ابعت: وقف التقارير");
  return true;
}

/** "أعلى من المتوسط بـ 12%" — sale listings with enough similar ones only. */
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
  const vsMarket = marketLine(state, l, cur);
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
    vsMarket ? `\n${vsMarket}` : null,
    "",
    "لو فيه أي تغيير في السعر أو الحالة ابعتهولي هنا 🙏",
    re.contactLine(a) || null,
    `\n${STOP_LINE}`,
  ]
    .filter((x) => x !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Sends the report to the owner and notes when. `sock`: app.sock or ctx.sock. */
async function deliver({ sock, state }, l, now = Date.now()) {
  await sock.sendMessage(`${l.owner.phone}@s.whatsapp.net`, { text: text(state, l, now) });
  re.update(state, l.id, { reportedAt: now }, l.updated); // a report isn't an update of the listing
}

/** By hand (.listing report 12 send). @returns {Promise<"sent"|"off"|"recent">} */
async function send(ctx, l, now = Date.now()) {
  if (!l.owner?.phone) throw new Error(`#${l.id} has no owner number`);
  if (reportsOff(ctx.state, l.owner.phone)) return "off";
  if (l.reportedAt && now - l.reportedAt < RESEND_AFTER) return "recent";
  await deliver(ctx, l, now);
  return "sent";
}

const hasNews = (l) => {
  const s = l.stats || {};
  return Boolean(s.sent || s.views || s.inquiries || s.posted || s.booked || l.feedback?.length);
};

/** Whether this listing's owner should get the weekly report now. */
const weeklyDue = (state, l, now = Date.now()) =>
  l.status === "available" &&
  Boolean(l.owner?.phone) &&
  !reportsOff(state, l.owner.phone) &&
  now - l.created >= WEEKLY_MIN_AGE &&
  !(l.reportedAt && now - l.reportedAt < WEEKLY_EVERY) &&
  hasNews(l);

/** The listings whose owners get this week's report (the oldest listings first, at most 30). */
const weeklyTargets = (state, now = Date.now()) =>
  re
    .all(state)
    .filter((l) => weeklyDue(state, l, now))
    .sort((a, b) => a.id - b.id)
    .slice(0, WEEKLY_MAX);

module.exports = { text, send, deliver, weeklyDue, weeklyTargets, reportsOff, setReports, reportsWord, handleWord, RESEND_AFTER, STOP_LINE };
