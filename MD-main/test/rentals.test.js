"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const rentals = require("../src/services/rentals");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const TENANT = "201001234567@s.whatsapp.net";
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`); // Cairo time

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `T${++n}`, remoteJid: from, fromMe: false }, pushName: "Agent", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

const ADD = ".rental add\nالعقار: 1\nالمستأجر: أحمد\nالموبايل: 01001234567\nالإيجار: ١٥ ألف\nيوم الاستحقاق: 5\nمن: 1/1/2026\nالمدة: سنة\nالتأمين: 30 ألف";

test("reading a rental: labels, Arabic digits, dates, durations; due dates and unpaid months", () => {
  const f = rentals.parseRentalText(ADD.replace(".rental add\n", ""), "201011112222");
  assert.deepEqual(f, { listing: 1, tenant: "أحمد", phone: "201001234567", rent: 15000, day: 5, start: "2026-01-01", months: 12, deposit: 30000 });
  assert.throws(() => rentals.parseRentalText("من: 31/2/2026"), /couldn't read the date/);
  assert.throws(() => rentals.parseRentalText("المدة: طويلة"), /couldn't read the duration/);
  assert.equal(rentals.addMonthsEnd("2026-01-01", 12), "2026-12-31");
  assert.equal(rentals.addMonthsEnd("2026-01-31", 1), "2026-02-28");

  const r = { rent: 15000, day: 31, start: "2026-01-01", end: "2026-12-31", tracked: "2026-03", payments: { "2026-03": { amount: 15000 } } };
  assert.equal(rentals.dueOf(r, "2026-02"), "2026-02-28", "day 31 in February is the 28th");
  const s = rentals.standing(r, "2026-06-10");
  assert.deepEqual(s.arrears, ["2026-04", "2026-05"], "from the month it was added; January and February count as settled");
  assert.equal(s.daysToDue, 20);
  assert.equal(rentals.standing(r, "2027-01-10").active, false);
});

test(".rental add, paid, the overview and the morning summary", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08") });
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "إيجار", location: "المعادي", price: 15000 }, ME);
  await b.send(ADD);
  let r = b.text();
  assert.match(r, /✅ Saved as rental \*#1\* \(listing #1 marked rented\)/);
  assert.match(r, /🏘️ \*إيجار #1\* — شقة — المعادي \(#1\)\n👤 المستأجر: أحمد \(\+201001234567\)\n💰 الإيجار: 15,000 جنيه شهرياً — يوم 5\n📅 العقد: 2026-01-01 → 2026-12-31 \(باقي 84 يوم\)\n🔒 التأمين: 30,000 جنيه/);
  assert.match(r, /\*أكتوبر 2026\*: 🔴 متأخر 3 يوم \(كان مستحقاً 2026-10-05\)/);
  assert.doesNotMatch(r, /شهور غير مدفوعة/, "months before it was added aren't counted");
  assert.equal(re.get(b.s, 1).status, "rented");

  await b.send(".rental add\nالوحدة: شقة الدقي ش التحرير\nالمستأجر: منى\nالإيجار: 12 ألف\nيوم الاستحقاق: 20\nمن: 2026-06-20");
  assert.match(b.text(), /Saved as rental \*#2\*/);
  assert.match(b.text(), /\*أكتوبر 2026\*: ⏳ مستحق 2026-10-20 \(بعد 12 يوم\)/);

  const morning = digest.build(b.s, "Africa/Cairo", at("2026-10-08", "08:30"));
  assert.match(morning, /💰 \*الإيجارات\*\n🔴 متأخر: #1 أحمد \(3 يوم\)/);
  assert.doesNotMatch(morning, /📄/u, "84 days to the end: not yet");

  await b.send(".rental paid 1");
  assert.match(b.text(), /✅ #1 أحمد: أكتوبر 2026 paid \(15,000 جنيه\)/);
  await b.send(".rental paid 1 سبتمبر 14 ألف");
  assert.match(b.text(), /سبتمبر 2026 paid \(14,000 جنيه\)/);
  await b.send(".rental paid 1 2027-05");
  assert.match(b.text(), /outside #1's contract/);
  await b.send(".rental paid 1 كتير");
  assert.match(b.text(), /Usage: \.rental paid 1/);

  await b.send(".rentals");
  r = b.text();
  assert.match(r, /🏘️ \*الإيجارات — أكتوبر 2026\* \(2 عقد ساري\)/);
  assert.match(r, /✅ مدفوع \(1\): #1 أحمد/);
  assert.match(r, /⏳ مستحق \(1\): #2 منى — بعد 12 يوم/);
  assert.match(r, /💰 المحصّل هذا الشهر: 15,000 جنيه من 27,000 جنيه/);

  t.mock.timers.setTime(at("2026-12-10"));
  await b.send(".rentals");
  assert.match(b.text(), /⚠️ شهور سابقة غير مدفوعة: #1 \(1 = /, "November was never paid");
  assert.match(b.text(), /📄 تنتهي خلال 60 يوماً: #1 \(2026-12-31، بعد 21 يوم\)/);
  assert.match(digest.build(b.s, "Africa/Cairo", at("2026-12-10", "08:30")), /📄 \*عقود تنتهي خلال 60 يوماً\*: #1 شقة — المعادي \(#1\) — بعد 21 يوم — جدّد أو جهّز إعادة التسويق/);

  await b.send(".rental unpaid 1 أكتوبر");
  assert.match(b.text(), /payment for 2026-10 was removed/);
  await b.send(".rentals", TENANT);
  assert.doesNotMatch(b.text(), /الإيجارات —/, "owner and sudo only");
  t.mock.timers.reset();
});

test("tenant reminders: on the due day, then every 3 days while late, in the day, once a day, not once paid", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-01") });
  const b = bot();
  await b.send(".rental add\nالوحدة: شقة الدقي\nالمستأجر: أحمد\nالإيجار: 15 ألف\nيوم الاستحقاق: 5\nمن: 2026-01-01");
  await b.send(".rental auto 1 on");
  assert.match(b.text(), /has no tenant number/);
  await b.send(".rental edit 1 الموبايل: 01001234567");
  await b.send(".rental auto 1 on");
  assert.match(b.text(), /🔔 #1: أحمد is reminded on the due day \(day 5\)/);

  const toTenant = () => b.sock.sent.filter((m) => m.jid === TENANT);
  assert.equal(await rentals.runReminders(b.app, at("2026-10-04", "11:00")), 0, "not before the due day");
  assert.equal(await rentals.runReminders(b.app, at("2026-10-05", "09:00")), 0, "not before 10:00");
  assert.equal(await rentals.runReminders(b.app, at("2026-10-05", "10:00")), 1);
  assert.match(toTenant().at(-1).content.text, /^أهلاً أحمد 👋\nتذكير بإيجار أكتوبر 2026 للوحدة: شقة الدقي\n💰 15,000 جنيه — مستحق اليوم\./);
  assert.equal(await rentals.runReminders(b.app, at("2026-10-05", "15:00")), 0, "once a day");
  assert.equal(await rentals.runReminders(b.app, at("2026-10-07", "12:00")), 0, "2 days late: not yet");
  assert.equal(await rentals.runReminders(b.app, at("2026-10-08", "12:00")), 1, "3 days late");
  assert.match(toTenant().at(-1).content.text, /كان مستحقاً يوم 2026-10-05 \(منذ 3 يوم\)/);
  const late = [11, 14, 17, 20, 21].map((d) => at(`2026-10-${d}`, "12:00"));
  const counts = [];
  for (const when of late) counts.push(await rentals.runReminders(b.app, when));
  assert.deepEqual(counts, [1, 1, 1, 1, 0], "6, 9, 12 and 15 days late; not after");

  t.mock.timers.setTime(at("2026-11-02"));
  await b.send(".rental paid 1 11");
  assert.equal(await rentals.runReminders(b.app, at("2026-11-05", "10:30")), 0, "paid ahead: no reminder");

  await b.send(".rental remind 1");
  assert.match(b.text(), /already paid for نوفمبر 2026; nothing sent/);
  await b.send(".rental unpaid 1 11");
  await b.send(".rental remind 1");
  assert.match(b.text(), /📤 Reminder sent to أحمد/);
  t.mock.timers.reset();
});

test("renew with a raise, edit, delete (and the listing hint)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-12-01") });
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "إيجار", location: "المعادي", price: 15000 }, ME);
  await b.send(ADD);
  await b.send(".rental renew 1 الإيجار: 17 ألف");
  assert.match(b.text(), /🔁 #1 renewed until 2027-12-31 · الإيجار 15,000 جنيه → 17,000 جنيه \(\+13%\)/);
  await b.send(".rental renew 1 إلى: 2026-06-01");
  assert.match(b.text(), /The new end must be after 2027-12-31/);
  await b.send(".rental edit 1 يوم الاستحقاق: 10");
  assert.match(b.text(), /✏️ Updated #1: day/);
  await b.send(".rental edit 1 إلى: 2025-01-01");
  assert.match(b.text(), /must end after it starts/);
  await b.send(".rental del 1");
  assert.match(b.text(), /Rental #1 \(أحمد\) deleted\.\nListing #1 is still marked rented\. To market it again: \.listing status 1 available/);
  await b.send(".rental 1");
  assert.match(b.text(), /There is no rental #1/);
  t.mock.timers.reset();
});
