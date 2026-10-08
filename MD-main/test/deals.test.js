"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const hotleads = require("../src/services/hotleads");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`);

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
  const send = (text) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: ME, fromMe: false }, pushName: "Agent", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

test("hot clients: stage, a viewing soon, a recent message, listings in budget; going quiet costs points", (t) => {
  const now = at("2026-10-08");
  t.mock.timers.enable({ apis: ["Date"], now: now - 20 * DAY });
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.8e6 }, ME); // #1
  const cold = leads.add(s, { name: "قديم", phone: "201000000001", type: "فيلا" }, ME); // untouched for 20 days
  t.mock.timers.setTime(now - 5 * DAY);
  const quiet = leads.add(s, { name: "ساكت", phone: "201000000002", type: "شقة", location: "التجمع", max: 3e6 }, ME);
  leads.markSent(s, quiet.id, 1, ME, "أُرسل له العقار #1");
  t.mock.timers.setTime(now - 3 * HOUR);
  const warm = leads.add(s, { name: "متحمس", phone: "201000000003", type: "شقة", location: "التجمع", max: 3e6 }, ME);
  leads.update(s, warm.id, { status: "negotiating" });
  leads.seen(s, warm.id, now - 2 * HOUR);
  viewings.add(s, { lead: warm.id, listing: 1, at: now + 26 * HOUR, chat: ME, by: ME }, now - 2 * HOUR);
  const won = leads.add(s, { name: "اشترى", phone: "201000000004" }, ME);
  leads.update(s, won.id, { status: "won" });
  const out = leads.add(s, { name: "أوقف", phone: "201000000005", type: "شقة", location: "التجمع" }, ME);
  leads.setOptOut(s, out.id, true);
  t.mock.timers.setTime(now);

  const top = hotleads.hot(s, 10, now);
  assert.deepEqual(top.map((h) => h.lead.name), ["متحمس", "ساكت"], "closed, opted-out and cold-and-quiet clients aren't listed");
  const w = top[0];
  assert.equal(w.score, 40 + 25 + 20 + 5 + 5);
  assert.deepEqual(w.reasons, ["🤝 تفاوض", "👀 معاينة خلال 1 يوم", "💬 راسلك منذ 2 ساعة", "🏠 1 عقار في ميزانيته", "💰 ميزانية معروفة"]);
  assert.ok(top[1].reasons.includes("📭 لم يرد منذ 5 يوم"));
  assert.equal(hotleads.score(s, leads.get(s, cold.id), now).score, 10 - 15, "new but untouched for 20 days");
  assert.match(hotleads.line(w, "جنيه"), /^🔥 95 — \*#3\* متحمس .*\n {4}👀 معاينة خلال 1 يوم · 💬 راسلك منذ 2 ساعة/);
  assert.match(digest.build(s, "Africa/Cairo", now), /🔥 \*ابدأ بهؤلاء اليوم\*\n🔥 95 — \*#3\* متحمس/);
  for (let i = 0; i < 4; i++) re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.5e6 + i }, ME);
  const many = hotleads.score(s, leads.get(s, warm.id), now);
  assert.ok(many.reasons.includes("🏠 3+ عقار في ميزانيته"), "counted up to 3");
  assert.equal(many.score, 95 + 10, "3 listings at most count");
  t.mock.timers.reset();
});

test(".leads hot lists them; .lead won records a deal, marks the client won and the listing sold or rented", async () => {
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3.2e6 }, ME); // #1
  re.add(s, { type: "شقة", deal: "إيجار", location: "المعادي", price: 15000 }, ME); // #2
  const ahmed = leads.add(s, { name: "أحمد", phone: "201000000001", type: "شقة", location: "التجمع", max: 3.5e6, source: "فيسبوك" }, ME);
  const mona = leads.add(s, { name: "منى", phone: "201000000002", source: "إحالة" }, ME);
  await b.send(".leads hot");
  assert.match(b.text(), /^🔥 \*ابدأ بهؤلاء\* \(الأعلى أولاً\)\n\n🔥 \d+ — \*#1\* أحمد/);

  await b.send(`.lead won ${ahmed.id} #1 3.1 مليون 2.5%`);
  assert.match(b.text(), /^✅ \*صفقة\* — #1 أحمد\n🏠 #1 شقة — التجمع \(🔴 تم البيع\)\n💰 3,100,000 جنيه\n🧾 العمولة: 77,500 جنيه \(2\.5%\)/);
  const l = leads.get(s, ahmed.id);
  assert.equal(l.status, "won");
  assert.ok(l.wonAt);
  assert.deepEqual(l.deals.map(({ at: _at, ...d }) => d), [{ listing: 1, price: 3.1e6, commission: 77500, rate: 2.5, kind: "بيع" }]);
  assert.match(l.history.at(-1).text, /✅ صفقة #1 بـ 3\.1 مليون جنيه — عمولة 77,500 جنيه/);
  assert.equal(re.get(s, 1).status, "sold");

  await b.send(`.lead won ${mona.id} #2 عمولة 7500`);
  assert.match(b.text(), /🏠 #2 شقة — المعادي \(🔴 تم التأجير\)\n💰 15,000 جنيه\n🧾 العمولة: 7,500 جنيه$/m, "the listing's price when none is given; a rental becomes 'rented'");
  await b.send(`.lead won ${mona.id}`);
  assert.match(b.text(), /What was the price\?/);
  await b.send(`.lead won ${mona.id} #99`);
  assert.match(b.text(), /There is no listing #99/);
  await b.send(`.lead won ${mona.id} 2m 50%`);
  assert.match(b.text(), /from 0\.1% to 20%/);
  await b.send(`.lead won ${mona.id} كثير`);
  assert.match(b.text(), /I didn't understand "كثير"/);
});

test(".deals: this month, last month, a year, with the change and the sources", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-10") });
  const b = bot();
  const s = b.s;
  let k = 0;
  const c = (name, source) => leads.add(s, { name, phone: `20100000000${++k}`, source }, ME);
  await b.send(`.lead won ${c("سبتمبر", "فيسبوك").id} 2m 2%`); // 40,000 in September
  t.mock.timers.setTime(at("2026-10-03"));
  await b.send(`.lead won ${c("أحمد", "فيسبوك").id} 3m 2.5%`); // 75,000
  t.mock.timers.setTime(at("2026-10-07"));
  await b.send(`.lead won ${c("منى", "إحالة").id} 4m عمولة 85 ألف`); // 85,000

  await b.send(".deals");
  const r = b.text();
  assert.match(r, /^💼 \*الصفقات — أكتوبر 2026\*\n✅ 2 صفقة · 💰 7 مليون جنيه · 🧾 عمولة 160,000 جنيه\nالشهر السابق: 1 صفقة · عمولة 40,000 جنيه \(\+300%\)/);
  assert.match(r, /▫️ 7 أكتوبر — #3 منى — بيع — 4 مليون — عمولة 85,000\n▫️ 3 أكتوبر — #2 أحمد/);
  assert.match(r, /📣 حسب المصدر: فيسبوك 1 · إحالة 1|📣 حسب المصدر: إحالة 1 · فيسبوك 1/);
  await b.send(".deals last");
  assert.match(b.text(), /الصفقات — سبتمبر 2026\*\n✅ 1 صفقة/);
  await b.send(".deals 2026");
  assert.match(b.text(), /الصفقات — 2026\*\n✅ 3 صفقة · 💰 9 مليون جنيه · 🧾 عمولة 200,000 جنيه\nالسنة السابقة: 0 صفقة/);
  assert.match(b.text(), /▫️ سبتمبر 2026: 1 صفقة · عمولة 40,000 جنيه\n▫️ أكتوبر 2026: 2 صفقة · عمولة 160,000 جنيه/);
  await b.send(".deals 2026-08");
  assert.match(b.text(), /No deals recorded/);
  await b.send(".deals soon");
  assert.match(b.text(), /Usage: \.deals/);
  t.mock.timers.reset();
});
