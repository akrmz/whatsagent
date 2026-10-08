"use strict";

const re = require("./realestate");
const projects = require("./projects");
const { limiterFor } = require("../core/ratelimit");

/**
 * A menu clients can browse in a private chat (.agent catalog on): "عقارات" shows the available
 * listings grouped by type and sale/rent (and the developers' projects), with counts; a number
 * opens a group (cheapest first, up to 10); "#12" then shows one listing; "0" goes back.
 * Each client's open menu is remembered for 10 minutes, in memory only.
 */

const TRIGGER = /^(?:عقارات|العقارات|قائمة|القائمة|العروض|عروض|منيو|كتالوج|الكتالوج|menu|catalog|catalogue|listings)$/i;
const OPEN_FOR = 10 * 60 * 1000;
const MAX_SHOWN = 10;
const PLURAL = {
  شقة: "شقق", فيلا: "فيلات", دوبلكس: "دوبلكس", بنتهاوس: "بنتهاوس", "تاون هاوس": "تاون هاوس", "توين هاوس": "توين هاوس", شاليه: "شاليهات",
  استوديو: "استوديوهات", محل: "محلات", مكتب: "مكاتب", عيادة: "عيادات", أرض: "أراضي", عمارة: "عمارات",
};
const DIGITS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const num = (n) => (n < 10 ? DIGITS[n] : `${n}.`);

// Open menus per bot (WeakMap on the state, like the rate limiters), at most 2,000 clients.
const sessionsByState = new WeakMap();
function sessions(state) {
  let m = sessionsByState.get(state);
  if (!m) sessionsByState.set(state, (m = new Map()));
  return m;
}
function remember(state, who, groups, now) {
  const m = sessions(state);
  m.delete(who);
  m.set(who, { groups, at: now });
  if (m.size > 2000) m.delete(m.keys().next().value);
}

/** The groups, largest first: { label, count, type?, deal?, projects? } */
function groups(state) {
  const by = new Map();
  for (const l of re.all(state).filter((x) => x.status === "available")) {
    const type = l.type || "عقار";
    const deal = l.deal || "بيع";
    const key = `${type}|${deal}`;
    if (!by.has(key)) by.set(key, { label: `${PLURAL[type] || (type === "عقار" ? "عقارات أخرى" : type)} لل${deal}`, type, deal, count: 0 });
    by.get(key).count++;
  }
  // Largest first; ties: sale before rent, then by name (a menu shouldn't reshuffle).
  const list = [...by.values()].sort((a, b) => b.count - a.count || (a.deal === b.deal ? 0 : a.deal === "بيع" ? -1 : 1) || a.label.localeCompare(b.label, "ar"));
  const p = projects.all(state).length;
  if (p) list.push({ label: "🏗️ مشروعات جديدة بالتقسيط", projects: true, count: p });
  return list;
}

function menuText(state, list) {
  if (!list.length) return "حالياً مفيش عقارات متاحة، ابعتلي طلبك وأبلغك أول ما يتوفر 👍";
  return [`🏠 *العقارات المتاحة*`, "", ...list.map((g, i) => `${num(i + 1)} ${g.label} (${g.count})`), "", "اكتب رقم القسم اللي يهمك 👇"].join("\n");
}

function groupText(state, g) {
  const cur = re.agent(state).currency;
  if (g.projects) {
    const all = projects.all(state);
    return [`🏗️ *مشروعات جديدة بالتقسيط* (${all.length})`, "", ...all.slice(0, MAX_SHOWN).map((p) => projects.line(p, cur)), "", "للتفاصيل اسأل عن المشروع باسمه · 0 للقائمة"].join("\n");
  }
  const items = re
    .all(state)
    .filter((l) => l.status === "available" && (l.type || "عقار") === g.type && (l.deal || "بيع") === g.deal)
    .sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
  const more = items.length - MAX_SHOWN;
  return [
    `🏠 *${g.label}* (${items.length})`,
    "",
    ...items.slice(0, MAX_SHOWN).map((l) => re.line(l, cur)),
    more > 0 ? `… و${more} كمان — اكتب طلبك (مثلاً: ${g.type} في التجمع حتى 3 مليون)` : null,
    "",
    `للتفاصيل والصور أرسل رقم العقار (مثلاً #${items[0]?.id ?? 1}) · 0 للقائمة`,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/**
 * A client's private message: the trigger word opens the menu; with a menu open, a number picks
 * a group and 0 shows the menu again. @returns {Promise<boolean>} true if it was handled
 */
async function handle(ctx, now = Date.now()) {
  const text = re.latinDigits(ctx.body.trim()).replace(/[.!؟?]+$/, "");
  const who = ctx.sender;
  const open = sessions(ctx.state).get(who);
  const isOpen = open && now - open.at < OPEN_FOR;
  if (!TRIGGER.test(text) && !(isOpen && /^\d{1,2}$/.test(text))) return false;
  // At most 6 menu steps a minute per client; beyond that, silence (a flood isn't answered).
  if (!limiterFor(ctx.state, "catalog-client", { max: 6, windowMs: 60 * 1000 })(who)) return true;
  if (TRIGGER.test(text) || text === "0") {
    const list = groups(ctx.state);
    remember(ctx.state, who, list, now);
    await ctx.reply(menuText(ctx.state, list));
    return true;
  }
  const g = open.groups[Number(text) - 1];
  if (!g) {
    await ctx.reply(`اختار رقم من 1 لـ ${open.groups.length}، أو 0 للقائمة.`);
    return true;
  }
  remember(ctx.state, who, open.groups, now); // still open
  await ctx.reply(groupText(ctx.state, g));
  return true;
}

module.exports = { handle, groups, menuText, groupText, TRIGGER, OPEN_FOR };
