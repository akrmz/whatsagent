"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const english = require("../src/services/english");
const assistant = require("../src/services/assistant");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const NOW = Date.parse("2026-10-10T12:00:00+03:00");
const strip = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "notes"));

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
  const send = (text) => d.handleMessage(sock, { key: { id: `L${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: () => sock.sent.at(-1).content.text || "" };
}

test("delivery of off-plan resale: read as a year, shown on the cards, past years dropped", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  assert.deepEqual(strip(re.parseListingText("شقة للبيع في التجمع 150 متر السعر 4 مليون مقدم 800 ألف استلام 2027")), { type: "شقة", deal: "بيع", size: 150, price: 4e6, down: 8e5, delivery: 2027, location: "التجمع" });
  assert.deepEqual(strip(re.parseListingText("فيلا في زايد تسليم ديسمبر 2028")), { type: "فيلا", delivery: 2028, location: "زايد" });
  assert.equal(re.parseListingText("شقة استلام بعد سنتين").delivery, 2028, "two years from now");
  assert.deepEqual(re.parseListingText("النوع: شاليه\nالاستلام: فوري").features, ["استلام فوري"]);
  assert.equal(re.parseListingText("شقة استلام 2020").delivery, undefined, "delivered already: not off-plan");
  const l = { id: 1, type: "شقة", deal: "بيع", price: 4e6, delivery: 2027, status: "available" };
  assert.match(re.card(l, { currency: "جنيه" }), /\n🔑 الاستلام: 2027\n/);
  assert.match(english.card(l, { currency: "جنيه" }), /🔑 Delivery 2027/);
  t.mock.timers.reset();
});

test("buyers who need it by a year match only units delivered by then (resales count as ready); search too", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const strip2 = (x) => strip(x);
  assert.deepEqual(strip2(leads.parseLeadText("عايز شقة في التجمع استلام قبل 2027")), { type: "شقة", location: "التجمع", deliveryBy: 2026 });
  assert.deepEqual(strip2(leads.parseLeadText("عايز فيلا استلام خلال سنتين")), { type: "فيلا", deliveryBy: 2028 });
  assert.deepEqual(strip2(leads.parseLeadText("عايز شقة ميزانية 3 مليون استلام لحد 2028")), { type: "شقة", deliveryBy: 2028, max: 3e6 }, "the year isn't a budget");
  const by2026 = { type: "شقة", deliveryBy: 2026 };
  assert.ok(leads.fits(by2026, { type: "شقة", status: "available" }), "a resale is ready");
  assert.ok(leads.fits(by2026, { type: "شقة", delivery: 2026, status: "available" }));
  assert.equal(leads.fits(by2026, { type: "شقة", delivery: 2028, status: "available" }), null);
  assert.deepEqual(assistant.parseWants("type=شقة; delivery=2027"), { type: "شقة", deliveryBy: 2027 });

  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 4e6, delivery: 2027 }, ME); // #1
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 4e6, delivery: 2029 }, ME); // #2
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 4e6 }, ME); // #3: ready
  await b.send(".listings استلام 2027");
  assert.match(b.last(), /^🏠 \*2 available\*/);
  assert.doesNotMatch(b.last(), /#2\*/);
  t.mock.timers.reset();
});

test(".listing add says how the price per m² compares with similar listings", async () => {
  const b = bot();
  for (const price of [3e6, 3e6, 3.3e6]) re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price, size: 150 }, ME);
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.75 مليون\nالمساحة: 150");
  assert.match(b.last(), /📈 سعر المتر 25,000 جنيه — أعلى من المتوسط بـ 25% ⚠️ \(متوسط 3 عقار مشابه: 20,000 جنيه\) · \.market 4/);
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.1 مليون\nالمساحة: 150");
  assert.match(b.last(), /في حدود المتوسط ✅/);
  await b.send(".listing add\nالنوع: فيلا\nللبيع\nالمنطقة: زايد\nالسعر: 9 مليون\nالمساحة: 300");
  assert.doesNotMatch(b.last(), /📈/, "no similar listings: nothing to compare");
});
