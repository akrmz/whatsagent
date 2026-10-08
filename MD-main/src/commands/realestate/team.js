"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const team = require("../../services/team");
const deals = require("../../services/deals");
const rentals = require("../../services/rentals");
const { UserError } = require("../../core/errors");

const BOT = "🤖";

module.exports = {
  name: "team",
  aliases: ["fareeq", "teamstats", "performance"],
  category: "realestate",
  description:
    "أداء الفريق — what each team member (the owner and sudo users) did this month: clients added, listings/offers/welcomes sent, viewings booked, deals closed and commission, and the active clients assigned to them. Automatic work (clients saved from #12 questions and written requests, automatic answers) is grouped as 🤖. \"last\" for last month, or a month (2026-09). Owner and sudo users.",
  usage: "[last | YYYY-MM]",
  examples: [".team", ".team last", ".team 2026-09"],
  permission: "sudo",
  cooldown: 3,
  async run(ctx) {
    const arg = re.latinDigits(ctx.args[0] || "").toLowerCase();
    const thisMonth = team.monthOf(Date.now());
    const mk = !arg ? thisMonth : /^(last|previous|السابق|الماضي)$/.test(arg) ? deals.previousMonth(thisMonth) : /^\d{4}-\d{2}$/.test(arg) ? arg : null;
    if (!mk) throw new UserError(`Usage: ${ctx.prefix}team [last | 2026-09]`);

    const { identity, permissions } = ctx.app;
    const isMember = (jid) => permissions.isOwner(jid) || permissions.isSudo(jid);
    // Counters are kept under whatever id did the work; team members are merged by phone number.
    const rows = new Map();
    const row = (key) => rows.get(key) || rows.set(key, { leads: 0, sent: 0, viewings: 0, deals: 0, commission: 0, assigned: 0 }).get(key);
    for (const [by, c] of Object.entries(team.month(ctx.state, mk))) {
      const pn = identity.toPn(by) || by;
      const r = row(isMember(by) || isMember(pn) ? pn : BOT);
      for (const k of team.KINDS) r[k] += c[k] || 0;
    }
    // Assigned clients are a "now" figure: only in this month's report.
    if (mk === thisMonth) for (const l of leads.all(ctx.state)) if (l.assignee && !["won", "lost"].includes(l.status)) row(identity.toPn(l.assignee) || l.assignee).assigned++;

    const cur = re.agent(ctx.state).currency;
    const members = [...rows].filter(([k]) => k !== BOT).sort((a, b) => b[1].deals - a[1].deals || b[1].commission - a[1].commission || b[1].viewings - a[1].viewings);
    const auto = rows.get(BOT);
    const fmt = (r) =>
      [`➕ ${r.leads} عميل`, `📤 ${r.sent} إرسال`, `👀 ${r.viewings} معاينة`, `✅ ${r.deals} صفقة`, r.commission && `🧾 ${re.money(r.commission, cur)}`, r.assigned && `📂 ${r.assigned} عميل مسند`].filter(Boolean).join(" · ");
    const lines = [`👥 *أداء الفريق — ${rentals.arMonth(mk)}*`, ""];
    if (!members.length && !auto) lines.push(`Nothing recorded for ${mk} yet.`);
    for (const [jid, r] of members) lines.push(`▫️ @${jid.split("@")[0]}: ${fmt(r)}`);
    if (auto) lines.push(`▫️ ${BOT} تلقائي: ➕ ${auto.leads} عميل · 📤 ${auto.sent} إرسال`);
    lines.push("", `${ctx.prefix}lead assign <client> @member — give a client to someone · ${ctx.prefix}leads mine`);
    return ctx.reply({ text: lines.join("\n"), mentions: members.map(([jid]) => jid) });
  },
};
