"use strict";

const re = require("./realestate");
const leads = require("./leads");
const { zoneNow } = require("./gcschedule");
const { UserError } = require("../core/errors");

/**
 * Rentals the agent manages (.rental): the tenant, the monthly rent and its due day, the
 * contract dates, and which months are paid. The morning summary lists rent due and late,
 * and contracts ending soon (time to market the unit again); tenants can be reminded.
 *   DATA_DIR/rentals.json { seq, items: { [id]: rental } }
 *   rental: { id, listing?, unit?, tenant, phone?, rent, day, start, end, deposit?, payments: { "YYYY-MM": { amount, at, by } },
 *             tracked: "YYYY-MM" (unpaid months count from here), auto?, reminded? }
 */

const MAX_RENTALS = 500;
const ENDING_DAYS = 60;
const REMIND_FROM = 10 * 60; // tenant reminders from 10:00 …
const REMIND_TO = 21 * 60; // … to 21:00
const OVERDUE_EVERY = 3; // and again every 3 days while late, for 15 days
const OVERDUE_FOR = 15;

const store = (state) => state.store("rentals", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => a.id - b.id);

// ---- dates ("YYYY-MM-DD" strings in the bot's time zone) ------------------------------------

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthOf = (day) => day.slice(0, 7);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const toUtc = (day) => Date.UTC(...day.split("-").map((v, i) => Number(v) - (i === 1 ? 1 : 0)));
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
const arMonth = (mk) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(toUtc(`${mk}-01`)));

/** "2026-01-05", "5/1/2026", "5-1-2026" (day first, as written in Egypt) → "2026-01-05" */
function parseDate(text) {
  const t = re.latinDigits(String(text || "").trim());
  let y, mo, d, m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, mo, y] = [m[1], m[2], m[3]].map(Number);
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return ymd(y, mo, d);
}

/** "سنة" / "سنتين" / "6 شهور" / "18 شهر" / "2 سنة" → months */
function parseMonths(text) {
  const t = re.latinDigits(String(text || "")).trim();
  if (/^(سنة|سنه|year|عام)$/i.test(t)) return 12;
  if (/^(سنتين|سنتان|عامين)$/.test(t)) return 24;
  const m = t.match(/^(\d{1,3})\s*(شهر|شهور|أشهر|اشهر|months?|سنة|سنه|سنوات|سنين|years?)?$/i);
  if (!m) return null;
  const n = Number(m[1]) * (/^(سنة|سنه|سنوات|سنين|years?)$/i.test(m[2] || "") ? 12 : 1);
  return n >= 1 && n <= 120 ? n : null;
}

/** The day before the same date `months` later: a year from 2026-01-01 ends 2026-12-31. */
function addMonthsEnd(start, months) {
  const [y, m, d] = start.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  if (d > daysIn(ty, tm)) return ymd(ty, tm, daysIn(ty, tm)); // from 31 Jan, a month ends on 28/29 Feb
  const same = toUtc(ymd(ty, tm, d));
  const end = new Date(same - 86400000);
  return ymd(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
}

/** "2026-10" → its due date, the day clamped to the month (31 → 30 Nov). */
const dueOf = (r, mk) => {
  const [y, m] = mk.split("-").map(Number);
  return ymd(y, m, Math.min(r.day, daysIn(y, m)));
};

/** Months of the contract that are due by `today` (from the start month to this month). */
function dueMonths(r, today) {
  const out = [];
  let [y, m] = r.start.split("-").map(Number);
  const last = monthOf(today < r.end ? today : r.end);
  for (let i = 0; i < 240; i++) {
    const mk = `${y}-${pad(m)}`;
    if (mk > last) break;
    if (dueOf(r, mk) >= r.start && dueOf(r, mk) <= today && dueOf(r, mk) <= r.end) out.push(mk);
    m++;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/**
 * This month's state and older unpaid months.
 * @returns {{ month, due, paid, daysToDue, daysLate, arrears: string[], active, endsIn }}
 */
function standing(r, today) {
  const month = monthOf(today);
  const due = dueOf(r, month);
  const active = today >= r.start && today <= r.end;
  const inContract = due >= r.start && due <= r.end;
  const paid = Boolean(r.payments?.[month]);
  // Months before the rental was added to the bot are assumed settled (a running contract added mid-way).
  const arrears = dueMonths(r, today).filter((mk) => mk !== month && mk >= (r.tracked || "") && !r.payments?.[mk]);
  return {
    month,
    due,
    inContract,
    paid,
    daysToDue: daysBetween(today, due),
    daysLate: inContract && !paid && today > due ? daysBetween(due, today) : 0,
    arrears,
    active,
    endsIn: daysBetween(today, r.end),
  };
}

// ---- reading and changing -------------------------------------------------------------------

const LABELS = {
  listing: ["العقار", "رقم العقار", "listing"],
  unit: ["الوحدة", "وحدة", "الشقة", "العنوان", "unit", "address"],
  tenant: ["المستأجر", "مستأجر", "الساكن", "الاسم", "tenant", "name"],
  phone: ["الموبايل", "موبايل", "الهاتف", "الرقم", "رقم", "واتساب", "phone", "mobile"],
  rent: ["الإيجار", "الايجار", "إيجار", "ايجار", "القيمة", "rent"],
  day: ["يوم الاستحقاق", "يوم الدفع", "الاستحقاق", "موعد الدفع", "يوم", "due", "day"],
  start: ["من", "البداية", "بداية العقد", "start", "from"],
  end: ["إلى", "الى", "النهاية", "نهاية العقد", "حتى", "end", "to"],
  months: ["المدة", "مدة العقد", "مدة", "duration"],
  deposit: ["التأمين", "تأمين", "deposit"],
};
const LABEL_OF = new Map(Object.entries(LABELS).flatMap(([k, words]) => words.map((w) => [w.toLowerCase(), k])));

/** "label: value" lines → checked fields (only those written). */
function parseRentalText(text, ownerNumber) {
  const out = {};
  for (const raw of String(text || "").split(/\n+/)) {
    const m = raw.trim().match(/^([^:：]{1,20})\s*[:：]\s*(.+)$/);
    const key = m && LABEL_OF.get(m[1].trim().toLowerCase());
    if (!key) continue;
    const v = m[2].trim();
    if (key === "listing") out.listing = Number(re.latinDigits(v).replace(/^#/, "")) || undefined;
    else if (key === "unit") out.unit = v.slice(0, 80);
    else if (key === "tenant") out.tenant = v.slice(0, 60);
    else if (key === "phone") out.phone = leads.normalizePhone(v, ownerNumber) || undefined;
    else if (key === "rent" || key === "deposit") out[key] = re.parseAmount(v) || undefined;
    else if (key === "day") out.day = Number(re.latinDigits(v).match(/\d{1,2}/)?.[0]) || undefined;
    else if (key === "start" || key === "end") {
      out[key] = parseDate(v);
      if (!out[key]) throw new UserError(`I couldn't read the date "${v}". Write it like 2026-01-01 or 1/1/2026.`);
    } else if (key === "months") {
      out.months = parseMonths(v);
      if (!out.months) throw new UserError(`I couldn't read the duration "${v}". Write it like سنة, 6 شهور or 24.`);
    }
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

const USAGE =
  "Write it as lines, e.g.\n.rental add\nالعقار: 12\nالمستأجر: أحمد\nالموبايل: 01001234567\nالإيجار: 15 ألف\nيوم الاستحقاق: 5\nمن: 2026-01-01\nالمدة: سنة";

function add(state, fields, by, today) {
  const f = { ...fields };
  if (!f.tenant) throw new UserError(`Who is the tenant (المستأجر)?\n${USAGE}`);
  if (!(f.rent > 0)) throw new UserError(`How much is the rent (الإيجار)?\n${USAGE}`);
  if (!(f.day >= 1 && f.day <= 31)) f.day = Number((f.start || today).slice(8, 10));
  f.start ||= today;
  f.end ||= addMonthsEnd(f.start, f.months || 12);
  delete f.months;
  if (f.end <= f.start) throw new UserError("The contract must end after it starts.");
  if (f.listing && !re.get(state, f.listing)) throw new UserError(`There is no listing #${f.listing}.`);
  if (!f.listing && !f.unit) throw new UserError(`Which unit? Add "العقار: 12" (a listing) or "الوحدة: شقة المعادي ش 9".`);
  return store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_RENTALS) throw new UserError(`You have ${MAX_RENTALS} rentals saved. Delete ended ones first.`);
    const id = ++d.seq;
    d.items[id] = { id, ...f, payments: {}, tracked: monthOf(today), by, created: Date.now() };
    return d.items[id];
  });
}

function update(state, id, changes) {
  return store(state).update((d) => {
    const r = d.items[id];
    if (!r) throw new UserError(`There is no rental #${id}.`);
    Object.assign(r, changes);
    for (const k of Object.keys(r)) if (r[k] === null) delete r[k];
    return r;
  });
}

function pay(state, id, mk, amount, by, now = Date.now()) {
  return store(state).update((d) => {
    const r = d.items[id];
    if (!r) throw new UserError(`There is no rental #${id}.`);
    r.payments[mk] = { amount: amount || r.rent, at: now, by };
    return r;
  });
}

function unpay(state, id, mk) {
  return store(state).update((d) => {
    const r = d.items[id];
    if (!r?.payments[mk]) throw new UserError(`#${id} has no payment for ${mk}.`);
    delete r.payments[mk];
    return r;
  });
}

const remove = (state, id) =>
  store(state).update((d) => {
    const r = d.items[id];
    if (!r) throw new UserError(`There is no rental #${id}.`);
    delete d.items[id];
    return r;
  });

/** "شقة — التجمع (#12)" or the unit text */
function unitName(state, r) {
  const l = r.listing && re.get(state, r.listing);
  return l ? `${l.type || "عقار"}${l.location ? ` — ${l.location}` : ""} (#${l.id})` : r.unit || "—";
}

/** The reminder a tenant gets. */
function reminder(state, r, today) {
  const s = standing(r, today);
  const a = re.agent(state);
  const amount = re.money(r.rent, a.currency);
  const when = s.daysLate ? `كان مستحقاً يوم ${s.due} (منذ ${s.daysLate} يوم)` : s.daysToDue === 0 ? "مستحق اليوم" : `مستحق يوم ${s.due}`;
  const contact = re.contactLine(a);
  return `أهلاً ${r.tenant} 👋\nتذكير بإيجار ${arMonth(s.month)} للوحدة: ${unitName(state, r)}\n💰 ${amount} — ${when}.\nلو تم الدفع، تجاهل هذه الرسالة. شكراً لك 🙏${contact ? `\n\n${contact}` : ""}`;
}

/** Is a tenant reminder due today (auto reminders)? On the due day, then every 3 days while late. */
function reminderDue(r, today) {
  if (!r.auto || !r.phone || r.reminded === today) return false;
  const s = standing(r, today);
  if (!s.active || !s.inContract || s.paid) return false;
  if (s.daysToDue === 0) return true;
  return s.daysLate > 0 && s.daysLate <= OVERDUE_FOR && s.daysLate % OVERDUE_EVERY === 0;
}

async function runReminders(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const { day, minutes } = zoneNow(app.config.bot.timezone, now);
  if (minutes < REMIND_FROM || minutes >= REMIND_TO) return 0;
  let sent = 0;
  for (const r of all(app.state).filter((x) => reminderDue(x, day))) {
    update(app.state, r.id, { reminded: day }); // once a day even if sending fails
    try {
      await app.sock.sendMessage(`${r.phone}@s.whatsapp.net`, { text: reminder(app.state, r, day) });
      sent++;
    } catch (err) {
      app.log.warn({ rental: r.id, err: err.message }, "rent reminder not sent");
    }
  }
  return sent;
}

function startRentalsLoop(app) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runReminders(app);
    } catch (err) {
      app.log.error({ err }, "rentals loop failed");
    } finally {
      busy = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The morning summary's rentals lines (empty when there are none to mention). */
function digestLines(state, today) {
  const cur = re.agent(state).currency;
  const active = all(state).map((r) => ({ r, s: standing(r, today) })).filter(({ s }) => s.active);
  const dueToday = active.filter(({ s }) => s.inContract && !s.paid && s.daysToDue === 0);
  const late = active.filter(({ s }) => s.daysLate > 0);
  const owed = active.filter(({ s }) => s.arrears.length);
  const ending = active.filter(({ s }) => s.endsIn <= ENDING_DAYS).sort((a, b) => a.s.endsIn - b.s.endsIn);
  const lines = [];
  if (dueToday.length || late.length || owed.length) {
    lines.push("", "💰 *الإيجارات*");
    if (dueToday.length) lines.push(`مستحق اليوم: ${dueToday.map(({ r }) => `#${r.id} ${r.tenant} ${re.money(r.rent, cur)}`).join("، ")}`);
    if (late.length) lines.push(`🔴 متأخر: ${late.map(({ r, s }) => `#${r.id} ${r.tenant} (${s.daysLate} يوم)`).join("، ")}`);
    if (owed.length) lines.push(`⚠️ شهور سابقة غير مدفوعة: ${owed.map(({ r, s }) => `#${r.id} (${s.arrears.length})`).join("، ")}`);
  }
  if (ending.length) lines.push("", `📄 *عقود تنتهي خلال ${ENDING_DAYS} يوماً*: ${ending.map(({ r, s }) => `#${r.id} ${unitName(state, r)} — بعد ${s.endsIn} يوم`).join("، ")} — جدّد أو جهّز إعادة التسويق`);
  return lines;
}

module.exports = {
  get, all, add, update, pay, unpay, remove, parseRentalText, parseDate, parseMonths, addMonthsEnd,
  standing, dueMonths, dueOf, arMonth, monthOf, unitName, reminder, reminderDue, runReminders, startRentalsLoop, digestLines,
  ENDING_DAYS, USAGE,
};
