"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/** Clients by source: total, deals won, conversion; sorted by size. */
function bySource(all) {
  const m = new Map();
  for (const l of all) {
    const key = (l.source || "غير محدد").trim().toLowerCase();
    const e = m.get(key) || { name: l.source || "غير محدد", total: 0, won: 0 };
    e.total++;
    if (l.status === "won") e.won++;
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

module.exports = {
  name: "restats",
  aliases: ["mystats", "reportre", "ihsaat"],
  category: "realestate",
  description:
    "تقرير التسويق — which listings clients ask about most (views, inquiries, sent, posted), recent price cuts, listings not updated for 30+ days, where your clients come from and how many of each source closed a deal, and the average days to a deal. Owner and sudo users.",
  examples: [".restats"],
  permission: "sudo",
  cooldown: 5,
  async run(ctx) {
    const listings = re.all(ctx.state);
    const clients = leads.all(ctx.state);
    if (!listings.length && !clients.length) return ctx.reply(`Nothing to report yet. Start with ${ctx.prefix}listing add and ${ctx.prefix}lead add.`);
    const score = (l) => (l.stats?.views || 0) + 3 * (l.stats?.inquiries || 0);
    const top = listings.filter((l) => score(l) > 0).sort((a, b) => score(b) - score(a)).slice(0, 5);
    const s = (l) => l.stats || {};
    const cuts = listings.filter((l) => re.discount(l));
    const stale = re.stale(ctx.state, 30);
    const won = clients.filter((l) => l.status === "won");
    const days = won.filter((l) => l.wonAt).map((l) => (l.wonAt - l.created) / 86400000);
    const lines = ["📊 *تقرير التسويق العقاري*", ""];

    lines.push("🔥 *الأكثر طلباً*");
    lines.push(
      ...(top.length
        ? top.map((l) => `*#${l.id}* ${l.type || "عقار"}${l.location ? ` — ${l.location.slice(0, 25)}` : ""}: 👀 ${s(l).views || 0} · ❓ ${s(l).inquiries || 0} · 📤 ${s(l).sent || 0} · 📢 ${s(l).posted || 0}`)
        : ["لا توجد مشاهدات بعد (تُحسب عند طلب العميل #رقم أو .listing رقم)"]),
    );
    const unseen = listings.filter((l) => l.status === "available" && !s(l).views && !s(l).inquiries).length;
    if (unseen) lines.push(`👻 ${unseen} عقار متاح لم يطلبه أحد بعد — جرّب ${ctx.prefix}flyer أو ${ctx.prefix}autolistings`);
    if (cuts.length) lines.push("", `📉 *تخفيضات آخر 30 يوماً (${cuts.length})*: ${cuts.slice(0, 8).map((l) => `#${l.id} (−${re.discount(l).pct}%)`).join("، ")}`);
    if (stale.length) lines.push("", `🕸️ *لم تُحدَّث منذ 30+ يوماً (${stale.length})*: ${stale.slice(0, 10).map((l) => `#${l.id}`).join("، ")} — هل ما زالت متاحة؟`);

    if (clients.length) {
      lines.push("", `👥 *العملاء حسب المصدر* (${clients.length})`);
      lines.push(...bySource(clients).slice(0, 8).map((e) => `▫️ ${e.name}: ${e.total} عميل · ✅ ${e.won} صفقة (${pct(e.won, e.total)})`));
      const sentTo = clients.filter((l) => l.lastSentAt);
      if (sentTo.length) lines.push("", `📬 نسبة الرد: ${sentTo.filter((l) => l.replied).length} من ${sentTo.length} عميل أرسلت لهم عقاراً ردّوا (${pct(sentTo.filter((l) => l.replied).length, sentTo.length)})`);
      lines.push("", `✅ الصفقات: ${won.length} من ${clients.length} (${pct(won.length, clients.length)})${days.length ? ` · متوسط المدة حتى الصفقة: ${Math.round(days.reduce((a, b) => a + b, 0) / days.length)} يوم` : ""}`);
    }
    return ctx.reply(lines.join("\n"));
  },
  bySource,
};
