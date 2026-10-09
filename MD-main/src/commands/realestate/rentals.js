"use strict";

const re = require("../../services/realestate");
const rentals = require("../../services/rentals");
const { zoneNow } = require("../../services/gcschedule");
const { getText } = require("../../core/context");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const today = (ctx) => zoneNow(ctx.config.bot.timezone, Date.now()).day;
const owner = (ctx) => ctx.config.owners.numbers[0];
const cur = (ctx) => re.agent(ctx.state).currency;

const AR_MONTHS = [/^يناير$/, /^فبراير$/, /^مارس$/, /^[أا]بريل$/, /^مايو$/, /^يونيو$/, /^يوليو$/, /^[أا]غسطس$/, /^سبتمبر$/, /^[أا]كتوبر$/, /^نوفمبر$/, /^ديسمبر$/];

/** "2026-09", "9" or "سبتمبر" → "YYYY-MM" (a month after this one means last year's); null if it isn't a month. */
function monthArg(token, day) {
  const t = re.latinDigits(String(token || "")).trim();
  if (/^\d{4}-\d{2}$/.test(t) && Number(t.slice(5)) >= 1 && Number(t.slice(5)) <= 12) return t;
  let m = /^\d{1,2}$/.test(t) ? Number(t) : AR_MONTHS.findIndex((r) => r.test(t)) + 1;
  if (!(m >= 1 && m <= 12)) return null;
  const [y, now] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  return `${m > now ? y - 1 : y}-${String(m).padStart(2, "0")}`;
}

/** Everything after ".rental <sub> <id>", line breaks kept, or the replied-to message. */
const bodyAfter = (ctx) => ctx.text.replace(/^\S+\s+\S+\s*/, "").trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");

function card(ctx, r) {
  const day = today(ctx);
  const s = rentals.standing(r, day);
  const c = cur(ctx);
  const now = !s.inContract
    ? "—"
    : s.paid
      ? `✅ مدفوع (${re.money(r.payments[s.month].amount, c)})`
      : s.daysLate
        ? `🔴 متأخر ${s.daysLate} يوم (كان مستحقاً ${s.due})`
        : s.daysToDue === 0
          ? "⏳ مستحق اليوم"
          : `⏳ مستحق ${s.due} (بعد ${s.daysToDue} يوم)`;
  const recent = Object.entries(r.payments || {})
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 6)
    .map(([mk, p]) => `${mk} ✅ ${re.group(p.amount)}`);
  return [
    `🏘️ *إيجار #${r.id}* — ${rentals.unitName(ctx.state, r)}`,
    `👤 المستأجر: ${r.tenant}${r.phone ? ` (+${r.phone})` : ""}`,
    `💰 الإيجار: ${re.money(r.rent, c)} شهرياً — يوم ${r.day}`,
    `📅 العقد: ${r.start} → ${r.end}${s.endsIn >= 0 ? ` (باقي ${s.endsIn} يوم)` : " (انتهى)"}`,
    r.deposit && `🔒 التأمين: ${re.money(r.deposit, c)}`,
    `🔔 تذكير تلقائي للمستأجر: ${r.auto ? "مفعّل" : "متوقف"}`,
    "",
    `*${rentals.arMonth(s.month)}*: ${now}`,
    s.arrears.length ? `⚠️ شهور غير مدفوعة: ${s.arrears.join("، ")} (${re.money(s.arrears.length * r.rent, c)})` : null,
    recent.length ? `*آخر المدفوعات:* ${recent.join(" · ")}` : null,
  ]
    .filter((x) => x !== null && x !== undefined && x !== false)
    .join("\n");
}

function overview(ctx) {
  const day = today(ctx);
  const c = cur(ctx);
  const items = rentals.all(ctx.state).map((r) => ({ r, s: rentals.standing(r, day) }));
  const active = items.filter(({ s }) => s.active);
  if (!items.length) return ctx.reply(`No rentals yet.\n${rentals.USAGE}`);
  const due = active.filter(({ s }) => s.inContract);
  const paid = due.filter(({ s }) => s.paid);
  const late = due.filter(({ s }) => s.daysLate);
  const upcoming = due.filter(({ s }) => !s.paid && !s.daysLate).sort((a, b) => a.s.daysToDue - b.s.daysToDue);
  const owed = active.filter(({ s }) => s.arrears.length);
  const ending = active.filter(({ s }) => s.endsIn <= rentals.ENDING_DAYS).sort((a, b) => a.s.endsIn - b.s.endsIn);
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const lines = [`🏘️ *الإيجارات — ${rentals.arMonth(rentals.monthOf(day))}* (${active.length} عقد ساري)`, ""];
  if (paid.length) lines.push(`✅ مدفوع (${paid.length}): ${paid.map(({ r }) => `#${r.id} ${r.tenant}`).join("، ")}`);
  if (upcoming.length) lines.push(`⏳ مستحق (${upcoming.length}): ${upcoming.map(({ r, s }) => `#${r.id} ${r.tenant} — ${s.daysToDue ? `بعد ${s.daysToDue} يوم` : "اليوم"}`).join("، ")}`);
  if (late.length) lines.push(`🔴 متأخر (${late.length}): ${late.map(({ r, s }) => `#${r.id} ${r.tenant} — ${s.daysLate} يوم`).join("، ")}`);
  lines.push(`💰 المحصّل هذا الشهر: ${re.money(sum(paid, ({ r, s }) => r.payments[s.month].amount), c)} من ${re.money(sum(due, ({ r }) => r.rent), c)}`);
  if (owed.length) lines.push(`⚠️ شهور سابقة غير مدفوعة: ${owed.map(({ r, s }) => `#${r.id} (${s.arrears.length} = ${re.shortAr(s.arrears.length * r.rent)})`).join("، ")}`);
  if (ending.length) lines.push(`📄 تنتهي خلال ${rentals.ENDING_DAYS} يوماً: ${ending.map(({ r, s }) => `#${r.id} (${r.end}، بعد ${s.endsIn} يوم)`).join("، ")}`);
  const ended = items.length - active.length;
  if (ended) lines.push(`\n${ended} عقد منتهٍ أو لم يبدأ بعد.`);
  lines.push("", `${ctx.prefix}rental <number> details · ${ctx.prefix}rental paid <number> · ${ctx.prefix}rental add`);
  return ctx.reply(lines.join("\n"));
}

const HELP = (p) =>
  [
    "🏘️ *Rentals · الإيجارات*",
    `${p}rental add (then lines: العقار/الوحدة، المستأجر، الموبايل، الإيجار، يوم الاستحقاق، من، المدة) — add`,
    `${p}rentals — this month: paid, due, late; contracts ending`,
    `${p}rental 3 — details · ${p}rental paid 3 [month] [amount] · ${p}rental unpaid 3 <month>`,
    `${p}rental remind 3 — remind the tenant now · ${p}rental auto 3 on|off — on the due day and while late`,
    `${p}rental renew 3 [المدة: سنة] [الإيجار: 17 ألف] · ${p}rental edit 3 <lines> · ${p}rental del 3`,
  ].join("\n");

module.exports = [
  {
    name: "rental",
    clientData: true,
    aliases: ["tenant", "ijar", "lease"],
    category: "realestate",
    description:
      "إدارة الإيجارات — the rentals you manage: tenant, monthly rent and due day, contract dates and deposit; record payments, see who is late and which months are unpaid, remind the tenant (now, or automatically on the due day and every 3 days while late, 10:00–21:00), and renew. The morning summary lists rent due and late, and contracts ending within 60 days. Owner and sudo users.",
    usage: "add <lines> | <id> | paid <id> [month] [amount] | unpaid <id> <month> | remind <id> | auto <id> on|off | renew <id> [lines] | edit <id> <lines> | del <id>",
    examples: [".rental add\nالعقار: 12\nالمستأجر: أحمد\nالموبايل: 01001234567\nالإيجار: 15 ألف\nيوم الاستحقاق: 5\nمن: 2026-01-01\nالمدة: سنة", ".rental paid 3", ".rental paid 3 سبتمبر", ".rental remind 3", ".rentals"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const day = today(ctx);
      if (!sub) return ctx.reply(HELP(ctx.prefix));
      const direct = idOf(sub);
      if (direct) {
        const r = rentals.get(ctx.state, direct);
        return ctx.reply(r ? card(ctx, r) : `There is no rental #${direct}.`);
      }
      if (sub === "list" || sub === "all") return overview(ctx);

      if (sub === "add" || sub === "new") {
        const text = ctx.text.replace(/^\S+\s*/, "").trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");
        const r = rentals.add(ctx.state, rentals.parseRentalText(text, owner(ctx)), ctx.sender, day);
        const l = r.listing && re.get(ctx.state, r.listing);
        if (l && l.status === "available") re.update(ctx.state, l.id, { status: "rented" });
        return ctx.reply(`✅ Saved as rental *#${r.id}*${l && l.status === "rented" ? ` (listing #${l.id} marked rented)` : ""}\n\n${card(ctx, r)}\n\n${r.phone ? `Automatic reminders to the tenant: ${ctx.prefix}rental auto ${r.id} on` : `Add the tenant's number to remind them: ${ctx.prefix}rental edit ${r.id} الموبايل: 0100…`}`);
      }

      const id = idOf(arg);
      if (!id) return ctx.reply(HELP(ctx.prefix));
      const r = rentals.get(ctx.state, id);
      if (!r) throw new UserError(`There is no rental #${id}.`);

      if (sub === "paid" || sub === "pay" || sub === "دفع") {
        const rest = ctx.args.slice(2);
        const mk = monthArg(rest[0], day);
        const amountText = (mk ? rest.slice(1) : rest).join(" ");
        const amount = amountText ? re.parseAmount(amountText) : null;
        if (amountText && !amount) throw new UserError(`Usage: ${ctx.prefix}rental paid ${id} [month] [amount], e.g. ${ctx.prefix}rental paid ${id} سبتمبر 15 ألف`);
        const month = mk || rentals.monthOf(day);
        if (month < rentals.monthOf(r.start) || month > rentals.monthOf(r.end)) throw new UserError(`${month} is outside #${id}'s contract (${r.start} → ${r.end}).`);
        rentals.pay(ctx.state, id, month, amount, ctx.sender);
        const s = rentals.standing(rentals.get(ctx.state, id), day);
        return ctx.reply(`✅ #${id} ${r.tenant}: ${rentals.arMonth(month)} paid (${re.money(amount || r.rent, cur(ctx))}).${s.arrears.length ? `\n⚠️ Still unpaid: ${s.arrears.join(", ")}` : ""}`);
      }
      if (sub === "unpaid" || sub === "undo") {
        const mk = monthArg(ctx.args[2], day);
        if (!mk) throw new UserError(`Which month? ${ctx.prefix}rental unpaid ${id} 2026-09`);
        rentals.unpay(ctx.state, id, mk);
        return ctx.reply(`↩️ #${id}: the payment for ${mk} was removed.`);
      }
      if (sub === "remind") {
        if (!r.phone) throw new UserError(`#${id} has no tenant number: ${ctx.prefix}rental edit ${id} الموبايل: 0100…`);
        const s = rentals.standing(r, day);
        if (s.paid) return ctx.reply(`#${id} has already paid for ${rentals.arMonth(s.month)}; nothing sent.`);
        await ctx.sock.sendMessage(`${r.phone}@s.whatsapp.net`, { text: rentals.reminder(ctx.state, r, day) });
        rentals.update(ctx.state, id, { reminded: day });
        return ctx.reply(`📤 Reminder sent to ${r.tenant} (+${r.phone}).`);
      }
      if (sub === "auto") {
        const on = /^(on|تشغيل|نعم)$/.test(String(ctx.args[2] || "").toLowerCase());
        const off = /^(off|ايقاف|إيقاف|لا)$/.test(String(ctx.args[2] || "").toLowerCase());
        if (!on && !off) throw new UserError(`${ctx.prefix}rental auto ${id} on | off`);
        if (on && !r.phone) throw new UserError(`#${id} has no tenant number: ${ctx.prefix}rental edit ${id} الموبايل: 0100…`);
        rentals.update(ctx.state, id, { auto: on || null });
        return ctx.reply(on ? `🔔 #${id}: ${r.tenant} is reminded on the due day (day ${r.day}) and every 3 days while late (up to 15 days), between 10:00 and 21:00, unless the month is marked paid.` : `🔕 #${id}: no automatic reminders.`);
      }
      if (sub === "renew") {
        const f = rentals.parseRentalText(bodyAfter(ctx), owner(ctx));
        const changes = { end: f.end || rentals.addMonthsEnd(nextDay(r.end), f.months || 12), ...(f.rent ? { rent: f.rent } : {}) };
        if (changes.end <= r.end) throw new UserError(`The new end must be after ${r.end}.`);
        const before = r.rent;
        const updated = rentals.update(ctx.state, id, changes);
        const raise = f.rent && before ? ` · الإيجار ${re.money(before, cur(ctx))} → ${re.money(f.rent, cur(ctx))} (${f.rent >= before ? "+" : ""}${Math.round((f.rent / before - 1) * 100)}%)` : "";
        return ctx.reply(`🔁 #${id} renewed until ${updated.end}${raise}\n\n${card(ctx, updated)}`);
      }
      if (sub === "edit") {
        const f = rentals.parseRentalText(bodyAfter(ctx), owner(ctx));
        delete f.months;
        if (!Object.keys(f).length) throw new UserError(`Write the fields to change, e.g. ${ctx.prefix}rental edit ${id} الإيجار: 16 ألف`);
        if (f.listing && !re.get(ctx.state, f.listing)) throw new UserError(`There is no listing #${f.listing}.`);
        const merged = { ...r, ...f };
        if (merged.end <= merged.start) throw new UserError("The contract must end after it starts.");
        return ctx.reply(`✏️ Updated #${id}: ${Object.keys(f).join(", ")}\n\n${card(ctx, rentals.update(ctx.state, id, f))}`);
      }
      if (sub === "del" || sub === "delete" || sub === "remove") {
        rentals.remove(ctx.state, id);
        const l = r.listing && re.get(ctx.state, r.listing);
        return ctx.reply(`🗑️ Rental #${id} (${r.tenant}) deleted.${l && l.status === "rented" ? `\nListing #${l.id} is still marked rented. To market it again: ${ctx.prefix}listing status ${l.id} available` : ""}`);
      }
      return ctx.reply(HELP(ctx.prefix));
    },
  },
  {
    name: "rentals",
    clientData: true,
    aliases: ["tenants", "ijarat", "leases"],
    category: "realestate",
    description: "الإيجارات هذا الشهر — your rentals: paid, due and late this month, the amount collected, unpaid earlier months, and contracts ending within 60 days. Owner and sudo users.",
    permission: "sudo",
    cooldown: 3,
    run: overview,
  },
];

/** "2026-12-31" → "2027-01-01" */
function nextDay(day) {
  const d = new Date(Date.UTC(...day.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0))) + 86400000);
  return d.toISOString().slice(0, 10);
}
