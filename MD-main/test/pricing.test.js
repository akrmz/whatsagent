"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const market = require("../src/services/market");
const offer = require("../src/services/offer");
const calc = require("../src/services/recalc");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: from, fromMe: false }, pushName: "Mona", message: { conversation: text } });
  const last = () => sock.sent.at(-1).content;
  return { app, sock, send, last, text: () => last().text || last().caption || "" };
}

/** Five flats in New Cairo at 20–28k per m², one in Zayed, one for rent. */
function catalogue(s) {
  const add = (f) => re.add(s, { deal: "بيع", ...f }, ME);
  add({ type: "شقة", location: "التجمع الخامس", price: 3e6, size: 150 }); // #1 20,000/m²
  add({ type: "شقة", location: "التجمع الخامس، النرجس", price: 3.3e6, size: 150 }); // #2 22,000
  add({ type: "شقة", location: "كمبوند ميفيدا التجمع الخامس", price: 3.6e6, size: 150 }); // #3 24,000
  add({ type: "شقة", location: "التجمع الخامس", price: 4.2e6, size: 150 }); // #4 28,000
  const sold = add({ type: "شقة", location: "التجمع الخامس", price: 3.45e6, size: 150 }); // #5 23,000, sold: still a real price
  re.update(s, sold.id, { status: "sold" });
  add({ type: "فيلا", location: "الشيخ زايد", price: 9e6, size: 300 }); // #6
  add({ type: "شقة", deal: "إيجار", location: "التجمع الخامس", price: 15000, size: 120, rooms: 2 }); // #7 125/m² a month
  add({ type: "شقة", location: "المعادي" }); // #8 no price or size
}

test("market figures: quantiles, areas, and grouping", () => {
  assert.equal(market.quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(market.quantile([10], 0.25), 10);
  assert.equal(market.areaOf("التجمع الخامس، النرجس"), "التجمع الخامس");
  assert.equal(market.areaOf("في المعادي - شارع 9"), "المعادي");
  const s = bot().app.state;
  catalogue(s);
  const r = market.report(s, "");
  const flats = r.groups.find((g) => g.name === "التجمع الخامس · شقة للبيع");
  assert.equal(flats.priced, 4, "#1, #2, #4, #5 (#3's location starts with كمبوند ميفيدا)");
  assert.equal(flats.median, 22500);
  const t = market.report(s, "شقة التجمع بيع");
  assert.deepEqual(t.groups.map((g) => [g.name, g.priced]), [["شقة للبيع", 5]]);
  assert.equal(t.groups[0].median, 23000);
});

test(".market lists price per m² by area; .market 12 compares a listing with similar ones", async () => {
  const b = bot();
  catalogue(b.app.state);
  await b.send(".market");
  let r = b.text();
  assert.match(r, /📊 \*أسعار السوق من كتالوجك\*\n8 عقار، منها 7 بسعر ومساحة/);
  assert.match(r, /▫️ \*التجمع الخامس · شقة للبيع\*: 4 · المتر 22,500 جنيه \(المعتاد 21,500 – 24,250\)/);
  assert.match(r, /▫️ \*التجمع الخامس · شقة للإيجار\*: 1 · إيجار المتر شهرياً 125 جنيه/);
  assert.doesNotMatch(r, /الشيخ زايد · فيلا للبيع\*: 1 · المتر 30,000 جنيه \(/, "no range for a single listing");

  await b.send(".market 4");
  r = b.text();
  assert.match(r, /💵 سعر المتر: \*28,000 جنيه\*/);
  assert.match(r, /📈 وسيط 4 عقار مشابه: 22,500 جنيه \(المعتاد 21,500 – 23,250\)/);
  assert.match(r, /⬆️ أعلى من الوسيط بـ 24%/);
  assert.match(r, /🎯 السعر الذي يضعه في منتصف السوق: 3\.23 مليون – 3\.49 مليون جنيه/);
  await b.send(".market 5");
  assert.match(b.text(), /✅ في حدود السوق/);
  await b.send(".market 6");
  assert.match(b.text(), /Only 0 similar listing/);
  await b.send(".market 8");
  assert.match(b.text(), /needs a price and a size/);
  await b.send(".market", CLIENT);
  assert.doesNotMatch(b.text(), /أسعار السوق/, "owner and sudo only");
});

test(".compare shows listings side by side and marks the best values", async () => {
  const b = bot();
  catalogue(b.app.state);
  re.update(b.app.state, 1, { rooms: 3, geo: { lat: 30.0074, lng: 31.4913 } });
  re.update(b.app.state, 4, { rooms: 3, finishing: "سوبر لوكس", geo: { lat: 30.03, lng: 31.47 } });
  await b.send(".compare 1 4", CLIENT);
  const r = b.text();
  assert.match(r, /⚖️ \*مقارنة\* #1 · #4/);
  assert.match(r, /💰 السعر: #1 3 مليون ✅ \| #4 4\.2 مليون/);
  assert.match(r, /💵 سعر المتر: #1 20,000 ✅ \| #4 28,000/);
  assert.match(r, /🛏 الغرف: #1 3 \| #4 3\n/, "equal values: no mark");
  assert.match(r, /✨ التشطيب: #1 — \| #4 سوبر لوكس/);
  assert.match(r, /📏 المسافة بينهما: 3\.2 كم/);
  assert.doesNotMatch(r, /🛁/, "a field nobody has is left out");
  await b.send(".compare 1");
  assert.match(b.text(), /Write 2 to 4 listing numbers/);
  await b.send(".compare 1 99");
  assert.match(b.text(), /There is no listing #99/);
});

test("payment schedule: dates every period from today, the total is exactly the price", () => {
  const plan = calc.installments("3500000 10% 8 quarterly");
  const rows = offer.schedule(plan, "Africa/Cairo", Date.parse("2026-10-08T10:00:00Z"));
  assert.equal(rows.length, 33);
  assert.deepEqual(rows[0], { n: 0, label: "المقدم — عند التعاقد", date: "8 أكتوبر 2026", amount: 350000 });
  assert.equal(rows[1].date, "8 يناير 2027");
  assert.equal(rows[32].date, "8 أكتوبر 2034");
  assert.equal(rows[1].amount, 98438);
  assert.equal(rows[32].amount, 98422, "the last one takes the rounding");
  assert.equal(rows.reduce((s, r) => s + r.amount, 0), 3500000);
  // The 31st plus a month is the end of the next month.
  assert.equal(offer.addMonths("2027-01-31", 1).toISOString().slice(0, 10), "2027-02-28");
  assert.equal(offer.addMonths("2028-01-31", 1).toISOString().slice(0, 10), "2028-02-29");
});

test(".offer makes a PDF with the plan and the flyer; 'send' sends it to the client and notes it", async () => {
  const b = bot();
  catalogue(b.app.state);
  const lead = leads.add(b.app.state, { name: "منى", phone: "201002223333" }, ME);
  await b.send(`.offer 2 #${lead.id} 10% 8 quarterly maint 8%`);
  const doc = b.last();
  assert.equal(doc.mimetype, "application/pdf");
  assert.equal(doc.fileName, "عرض-سعر-2-منى.pdf");
  assert.match(doc.caption, /📄 عرض سعر #2 لـ منى — 10% مقدم، 8 سنوات ربع سنوي/);
  const body = doc.document.toString("latin1");
  assert.ok(body.startsWith("%PDF"));
  assert.equal(body.match(/\/Type\s*\/Page\b/g).length, 3, "2 offer pages (33 payments) + the flyer");

  await b.send(".offer 1");
  assert.match(b.last().caption, /عرض سعر #1 — كاش/);
  assert.equal(b.last().document.toString("latin1").match(/\/Type\s*\/Page\b/g).length, 2);

  await b.send(`.offer 2 عميل ${lead.id} 20% 5 monthly send`);
  const sent = b.sock.sent.find((m) => m.jid === "201002223333@s.whatsapp.net");
  assert.ok(sent, "sent to the client's WhatsApp");
  assert.equal(sent.content.fileName, "عرض-سعر-2-منى.pdf");
  assert.match(sent.content.caption, /^أهلاً منى 👋\nمرفق عرض السعر للعقار #2/);
  assert.match(b.text(), /📤 Offer for #2 \(20% مقدم، 5 سنوات شهري\) sent to #1 منى/);
  const l = leads.get(b.app.state, lead.id);
  assert.equal(l.status, "contacted");
  assert.match(l.history.at(-1).text, /أُرسل له عرض سعر للعقار #2 \(20% مقدم، 5 سنوات شهري\)/);
  assert.equal(re.get(b.app.state, 2).stats.sent, 1);

  await b.send(".offer 7 10% 5");
  assert.match(b.text(), /Payment plans are for listings for sale/);
  await b.send(".offer 2 10% 5 send");
  assert.match(b.text(), /Send it to which client\?/);
  await b.send(".offer 2 #99");
  assert.match(b.text(), /There is no client #99/);
  await b.send(".offer 2 5");
  assert.match(b.text(), /The client goes with # \(#5\)/, "a client number without # reads as a plan: explain");
  await b.send(".offer 2 #1 10% 8 ربع سنوي");
  assert.match(b.last().caption, /10% مقدم، 8 سنوات ربع سنوي/);
  await b.send(".offer 8");
  assert.match(b.text(), /#8 has no price yet/);
  await b.send(".offer 2", CLIENT);
  assert.ok(!b.last().document, "owner and sudo only");
});
