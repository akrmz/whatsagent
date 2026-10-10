"use strict";

const re = require("../../services/realestate");
const deals = require("../../services/deals");
const bytype = require("../../services/bytype");
const rentals = require("../../services/rentals");
const { UserError } = require("../../core/errors");

const change = (now, before) => (before ? ` (${now >= before ? "+" : ""}${Math.round((now / before - 1) * 100)}%)` : "");
const dayOf = (t, timeZone) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", timeZone }).format(new Date(t));

module.exports = {
  name: "deals",
  clientData: true,
  aliases: ["sales", "safaqat", "revenue"],
  category: "realestate",
  description:
    "الصفقات والعمولات — the deals you closed (.lead won): this month by default, \"last\" for last month, a month (2026-09) or a year (2026). Count, total value and commission, compared with the period before, each deal, by unit type (apartments, chalets, villas …) and by client source. Owner and sudo users.",
  usage: "[last | YYYY-MM | YYYY]",
  examples: [".deals", ".deals last", ".deals 2026-09", ".deals 2026"],
  permission: "sudo",
  cooldown: 3,
  async run(ctx) {
    const tz = ctx.config.bot.timezone;
    const arg = re.latinDigits(ctx.args[0] || "").toLowerCase();
    const thisMonth = deals.monthOf(Date.now(), tz);
    let period;
    if (!arg) period = thisMonth;
    else if (/^(last|previous|السابق|الماضي)$/.test(arg)) period = deals.previousMonth(thisMonth);
    else if (/^\d{4}(-\d{2})?$/.test(arg)) period = arg;
    else throw new UserError(`Usage: ${ctx.prefix}deals [last | 2026-09 | 2026]`);

    const isYear = period.length === 4;
    const list = deals.inPeriod(ctx.state, period, tz);
    const before = isYear ? String(Number(period) - 1) : deals.previousMonth(period);
    const t = deals.totals(list);
    const p = deals.totals(deals.inPeriod(ctx.state, before, tz));
    const cur = re.agent(ctx.state).currency;
    const title = isYear ? period : rentals.arMonth(period);
    const lines = [`💼 *الصفقات — ${title}*`];
    if (!list.length) {
      lines.push("", `No deals recorded${p.count ? ` (${p.count} the period before)` : ""}. When you close one: ${ctx.prefix}lead won <client> #<listing> <price> <rate %>`);
      return ctx.reply(lines.join("\n"));
    }
    lines.push(`✅ ${t.count} صفقة · 💰 ${re.shortAr(t.value)} ${cur} · 🧾 عمولة ${re.money(t.commission, cur)}`);
    lines.push(`${isYear ? "السنة السابقة" : "الشهر السابق"}: ${p.count} صفقة · عمولة ${re.money(p.commission, cur)}${change(t.commission, p.commission)}`);
    if (isYear) {
      const months = new Map();
      for (const x of list) {
        const mk = deals.monthOf(x.deal.at, tz);
        months.set(mk, [...(months.get(mk) || []), x]);
      }
      lines.push("", ...[...months].sort().map(([mk, xs]) => `▫️ ${rentals.arMonth(mk)}: ${xs.length} صفقة · عمولة ${re.money(deals.totals(xs).commission, cur)}`));
    } else {
      lines.push(
        "",
        ...list.slice(0, 20).map(({ deal, lead }) => {
          const l = deal.listing && re.get(ctx.state, deal.listing);
          const what = l ? `#${l.id} ${l.type || "عقار"}${l.location ? ` ${l.location.slice(0, 20)}` : ""}` : deal.kind;
          return `▫️ ${dayOf(deal.at, tz)} — #${lead.id} ${lead.name || ""} — ${what} — ${re.shortAr(deal.price)}${deal.commission ? ` — عمولة ${re.group(deal.commission)}` : ""}`;
        }),
      );
    }
    // Apartments, chalets and villas apart.
    const types = bytype.deals(ctx.state, list);
    lines.push("", "🏷️ *حسب النوع*", ...types.map((e) => `▫️ ${e.type}: ${e.count} صفقة · 💰 ${re.shortAr(e.value)} ${cur}${e.commission ? ` · 🧾 عمولة ${re.money(e.commission, cur)}` : ""}`));
    const bySource = new Map();
    for (const { lead } of list) bySource.set(lead.source || "غير محدد", (bySource.get(lead.source || "غير محدد") || 0) + 1);
    lines.push("", `📣 حسب المصدر: ${[...bySource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ")}`);
    return ctx.reply(lines.join("\n"));
  },
};
