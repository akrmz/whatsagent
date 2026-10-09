"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const booking = require("../src/services/selfbooking");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const TZ = "Africa/Cairo";
const ME = "201011112222@s.whatsapp.net";
const MONA = "201099998888@s.whatsapp.net";
const KARIM = "201077776666@s.whatsapp.net";
const GROUP = "120363000000000088@g.us";
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`); // Cairo, summer time until the end of October
const when = (t) => viewings.when(t, TZ);

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: TZ }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `B${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: from === MONA ? "منى" : "كريم", message: { conversation: text } });
  re.setAgent(app.state, "name", "أحمد");
  return { app, sock, send, s: app.state, sentTo: (jid) => sock.sent.filter((m) => m.jid === jid), last: (jid) => (sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || sock.sent.filter((m) => m.jid === jid).at(-1)?.content.caption || "") };
}

test("a client books a free time themselves, the agent is told; taken and overlapping times aren't offered; cancel", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "15:30") }); // a Thursday
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME); // #1
  re.add(s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME); // #2
  const other = leads.add(s, { name: "عميل قديم" }, ME);
  viewings.add(s, { lead: other.id, listing: 2, at: at("2026-10-10", "12:30"), chat: ME, by: ME }); // the agent is busy Saturday 12:30

  await b.send("معاينة 1", { from: MONA });
  assert.equal(b.sentTo(MONA).length, 0, "off by default: no answer");
  await b.send(".agent booking on");
  assert.match(b.last(ME), /booking: on/);

  await b.send("#1", { from: MONA });
  assert.match(b.last(MONA), /🗓️ لحجز معاينة ابعت: معاينة 1$/);
  await b.send("عايز معاينة", { from: MONA });
  const offer = b.last(MONA);
  // Today from 2 hours on (18:00), no Friday, Saturday without the hours touching 12:30.
  const expected = [at("2026-10-08", "18:00"), at("2026-10-10", "11:00"), at("2026-10-10", "14:00"), at("2026-10-10", "15:00"), at("2026-10-10", "16:00"), at("2026-10-10", "17:00")];
  assert.equal(offer, ["🗓️ *مواعيد المعاينة المتاحة* — شقة في التجمع الخامس (#1)", "", ...expected.map((x, i) => `${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"][i]} ${when(x)}`), "", "اكتب رقم المعاد اللي يناسبك 👇"].join("\n"));

  await b.send("2", { from: MONA });
  assert.match(b.last(MONA), /^أهلاً منى 👋\nتم تأكيد موعد معاينة شقة في التجمع الخامس\n🗓️ /);
  assert.match(b.last(MONA), /لو حصل تغيير ابعت: الغاء المعاينة$/);
  const mona = leads.byPhone(s, "201099998888");
  assert.deepEqual([mona.name, mona.source, mona.status], ["منى", "حجز معاينة", "viewing"]);
  const v = viewings.upcoming(s).find((x) => x.lead === mona.id);
  assert.deepEqual([v.at, v.listing, v.chat, v.self, v.notifyClient], [at("2026-10-10", "11:00"), 1, ME, true, true]);
  assert.match(b.last(ME), new RegExp(`^📅 \\*حجز معاينة من العميل\\* \\(عميل جديد\\)\\n🗓️ \\*#${v.id}\\*[\\s\\S]*📞 \\+201099998888\\n\\nإلغاء: \\.viewing del ${v.id} · العميل: \\.lead ${mona.id}$`));

  await b.send("3", { from: MONA });
  assert.match(b.last(MONA), /الغاء المعاينة$/, "the offer is closed once booked: a number isn't read again");
  await b.send("معاينة 1", { from: KARIM });
  assert.doesNotMatch(b.last(KARIM), new RegExp(when(at("2026-10-10", "11:00"))), "a booked time isn't offered again");
  assert.match(b.last(KARIM), new RegExp(`1️⃣ ${when(at("2026-10-08", "18:00"))}`));

  await b.send("الغاء المعاينة", { from: MONA });
  assert.match(b.last(MONA), /^✅ اتلغى معاد المعاينة/);
  assert.match(b.last(ME), new RegExp(`^❌ منى \\(#${mona.id}\\) ألغى معاينة #1`));
  assert.equal(viewings.upcoming(s).some((x) => x.lead === mona.id), false);
  await b.send("الغاء المعاينة", { from: MONA });
  assert.match(b.last(MONA), /^مفيش معاينة محجوزة باسمك حالياً/);
  t.mock.timers.reset();
});

test("which listing: the number, else the last opened or sent; sold ones, groups, staff, a time taken meanwhile, 2 per client", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "09:00") });
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); // #1
  re.add(s, { type: "شقة", deal: "بيع", location: "المعادي", price: 4e6 }, ME); // #2
  re.add(s, { type: "شقة", deal: "بيع", location: "زايد", price: 2e6 }, ME); // #3
  re.update(s, 3, { status: "sold" });
  await b.send(".agent booking on");

  await b.send("معاينة", { from: MONA });
  assert.equal(b.last(MONA), "تحب تعاين أنهي عقار؟ ابعت رقمه، مثلاً: معاينة 12");
  await b.send("معاينة 3", { from: MONA });
  assert.match(b.last(MONA), /العقار #3 مش متاح/);
  const karim = leads.add(s, { name: "كريم", phone: "201077776666" }, ME);
  leads.markSent(s, karim.id, 2, ME, "أُرسل له العقار #2");
  await b.send("معاينة", { from: KARIM });
  assert.match(b.last(KARIM), /\(#2\)/, "the last one sent to them");

  await b.send("معاينة", { chat: GROUP, from: MONA });
  assert.equal(b.sentTo(GROUP).length, 0, "not in groups");
  const before = b.sentTo(ME).length;
  await b.send("معاينة 1");
  assert.equal(b.sentTo(ME).length, before, "staff book with .viewing add");

  // Two clients offered the same time: the second to pick it is told it's gone.
  await b.send("معاينة 1", { from: MONA });
  await b.send("1", { from: KARIM });
  await b.send("1", { from: MONA });
  assert.match(b.last(MONA), /^المعاد ده اتحجز لسه دلوقتي/);

  await b.send("معاينة 2", { from: KARIM });
  await b.send("1", { from: KARIM });
  await b.send("معاينة 1", { from: KARIM });
  await b.send("1", { from: KARIM });
  assert.match(b.last(KARIM), /^عندك 2 معاينات محجوزة بالفعل/);
  assert.equal(viewings.upcoming(s).filter((v) => v.lead === karim.id).length, 2);

  await b.send("عقارات", { from: KARIM });
  const n = b.sentTo(KARIM).length;
  await b.send("1", { from: KARIM });
  assert.equal(b.sentTo(KARIM).length, n, "the menu word closes the offer: a number isn't read as a time any more");
  t.mock.timers.reset();
});

test("viewing hours, days and length; the next free times for staff", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "09:00") }); // Thursday
  const b = bot();
  await b.send(".viewing slots");
  assert.match(b.last(ME), /^🗓️ \*Viewing hours for self-booking\*: السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس · 11:00–19:00 · 60 دقيقة للمعاينة\nClients booking themselves: off — \.agent booking on/);
  await b.send(".viewing days fri");
  await b.send(".viewing hours 12:00-14:00");
  await b.send(".viewing length 90");
  const r = b.last(ME);
  assert.match(r, /: الجمعة · 12:00–14:00 · 90 دقيقة للمعاينة/);
  assert.match(r, new RegExp(`Next free times:\\n▫️ ${when(at("2026-10-09", "12:00"))}\\n\\nChange:`), "one 90-minute viewing fits in 12–14, Fridays only, up to 7 days ahead");
  await b.send(".viewing hours 14:00-12:00");
  assert.match(b.last(ME), /start before end/);
  await b.send(".viewing length 10");
  assert.match(b.last(ME), /30 to 180 minutes/);
  booking.setDays(b.s, "sat-thu");
  assert.deepEqual(booking.settings(b.s).days, [6, 0, 1, 2, 3, 4]);
  booking.setDays(b.s, "السبت، الأحد");
  assert.deepEqual(booking.settings(b.s).days, [6, 0]);
  assert.throws(() => booking.setDays(b.s, "someday"), /Days like sat-thu/);
  t.mock.timers.reset();
});
