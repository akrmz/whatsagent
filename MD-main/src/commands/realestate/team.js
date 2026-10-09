"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const team = require("../../services/team");
const rotation = require("../../services/rotation");
const deals = require("../../services/deals");
const rentals = require("../../services/rentals");
const { UserError } = require("../../core/errors");

const BOT = "🤖";

/**
 * ".team autoassign @a @b [me]": new clients who arrive by themselves go to these members in
 * turn; "off" stops it; alone, it shows who is in the rotation and whose turn is next.
 */
function autoassign(ctx) {
  const p = ctx.prefix;
  const words = ctx.args.slice(1).map((w) => w.toLowerCase());
  const tag = (jid) => `@${jid.split("@")[0]}`;
  if (words.includes("off") || words.includes("stop")) {
    rotation.turnOff(ctx.state);
    return ctx.reply(`⏹️ New clients are no longer handed out in turn (notices go to the owner, or to the member a client is assigned to).`);
  }
  const picked = [...(words.some((w) => w === "me" || w === "أنا") ? [ctx.sender] : []), ...ctx.mentions];
  if (picked.length) {
    const { permissions, identity } = ctx.app;
    const bad = picked.filter((j) => !permissions.isOwner(j) && !permissions.isSudo(j));
    if (bad.length) throw new UserError(`Only the owner and sudo users can take clients (${bad.map(tag).join(", ")} isn't one: .sudo add).`);
    const s = rotation.setMembers(ctx.state, picked.map((j) => identity.toPn(j) || j));
    return ctx.reply({
      text: `🔄 New clients now go in turn to: ${s.members.map(tag).join(" → ")}\nThey arrive by themselves (a #12 question, a written request, the assistant, a self-booked viewing); each member gets that client's notices, viewing reminders and handoffs. Clients you add by hand aren't touched.\nStop: ${p}team autoassign off`,
      mentions: s.members,
    });
  }
  const s = rotation.settings(ctx.state);
  if (!s.on || !s.members.length) return ctx.reply(`🔄 Handing new clients out in turn is off.\nTurn it on with the members: ${p}team autoassign @colleague1 @colleague2 me`);
  return ctx.reply({ text: `🔄 New clients go in turn to: ${s.members.map(tag).join(" → ")}\nNext: ${rotation.nextMember(ctx.app) ? tag(rotation.nextMember(ctx.app)) : "nobody — no member is the owner or a sudo user any more"}\nStop: ${p}team autoassign off`, mentions: s.members });
}

module.exports = {
  name: "team",
  aliases: ["fareeq", "teamstats", "performance"],
  category: "realestate",
  description:
    "أداء الفريق — what each team member (the owner and sudo users) did this month: clients added, listings/offers/welcomes sent, viewings booked, deals closed and commission, and the active clients assigned to them. Automatic work (clients saved from #12 questions and written requests, automatic answers) is grouped as 🤖. \"last\" for last month, or a month (2026-09). \"autoassign @a @b\" hands new clients who arrive by themselves to these members in turn (their notices, viewing reminders and handoffs go to that member). Owner and sudo users.",
  usage: "[last | YYYY-MM] | autoassign @member … [me] | autoassign off",
  examples: [".team", ".team last", ".team 2026-09", ".team autoassign @Ahmed @Mona me", ".team autoassign off"],
  permission: "sudo",
  cooldown: 3,
  async run(ctx) {
    const arg = re.latinDigits(ctx.args[0] || "").toLowerCase();
    if (/^(autoassign|rotate|rotation|توزيع)$/.test(arg)) return autoassign(ctx);
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
