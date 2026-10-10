"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `P${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, down: 2e6, years: 5 }, ME); // #1
  re.add(s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", price: 12e6 }, ME); // #2 cash
  re.add(s, { type: "شقة", deal: "إيجار", location: "المعادي", price: 25e3 }, ME); // #3
  return { s, send, text: () => sock.sent.at(-1).content.text || "" };
}

test(".installments 12 for the team: the listing's plan, the what-if grid, and the down payment for a target instalment", async () => {
  const b = bot();
  await b.send(".installments 1");
  const r = b.text();
  assert.match(r, /^🧾 \*خطة سداد #1\* — شاليه للبيع — الساحل الشمالي\n💰 السعر: 9,000,000 جنيه\n💳 مقدم 2,000,000 جنيه \(22%\) · الباقي على 5 سنين ≈ 116,667 جنيه شهرياً\n/);
  assert.match(r, /📊 \*للتفاوض\* — القسط الشهري لو اتغير المقدم أو المدة:\n▫️ مقدم 10% \(900 ألف\): 5 سنين ≈ 135 ألف · 7 سنين ≈ 96\.4 ألف · 10 سنين ≈ 67\.5 ألف\n▫️ مقدم 20% \(1\.8 مليون\): 5 سنين ≈ 120 ألف/);
  assert.match(r, /مش عرض المالك/);

  await b.send(".installments 1 قسط 100 ألف");
  const t = b.text();
  assert.match(t, /🎯 \*عشان القسط يبقى 100 ألف شهرياً:\*\n▫️ على 5 سنين: مقدم 3 مليون \(33%\) ← مدة المالك\n▫️ على 7 سنين: مقدم 600 ألف \(7%\)\n▫️ على 10 سنين: من غير مقدم/);
  assert.doesNotMatch(t, /📊/, "a target instead of the grid");

  await b.send(".installments 1 3 مليون 7");
  assert.match(b.text(), /🧮 حسابك: مقدم 3,000,000 جنيه \(33\.3%\) · على 7 سنين ≈ \*71,429 جنيه\* شهرياً/);
  await b.send(".installments 1 20%");
  assert.match(b.text(), /🧮 حسابك: مقدم 1,800,000 جنيه \(20%\) · على 5 سنين/, "the owner's years when none are given");

  await b.send(".installments 2");
  assert.match(b.text(), /💵 العقار ده كاش \(من غير تقسيط من المالك\)\n\n📊/);
  await b.send(".installments 3");
  assert.match(b.text(), /^#3 is for rent: there is no payment plan/);
  await b.send(".installments #9");
  assert.equal(b.text(), "There is no listing #9.");
});

test(".installments 12 for a client: the real plan and their own sum, no what-ifs; plain amounts still work", async () => {
  const b = bot();
  await b.send(".installments 1", CLIENT);
  assert.match(b.text(), /💳 مقدم 2,000,000 جنيه \(22%\)/);
  assert.doesNotMatch(b.text(), /📊|للتفاوض/, "what-ifs could read as the owner's offer");
  await b.send(".installments 1 قسط 50 ألف", CLIENT);
  assert.doesNotMatch(b.text(), /🎯/);
  await b.send(".installments 2", CLIENT);
  assert.match(b.text(), /💵 العقار ده كاش/);
  assert.doesNotMatch(b.text(), /▫️ مقدم 10%/, "no instalment table for a cash unit");
  await b.send(".installments 1 30% 7", CLIENT);
  assert.match(b.text(), /🧮 حسابك: مقدم 2,700,000 جنيه \(30%\) · على 7 سنين ≈ \*75,000 جنيه\* شهرياً/);

  // A price, not a listing: as before.
  await b.send(".installments 2 مليون 300 ألف 5 شهري", CLIENT);
  assert.match(b.text(), /^🧾 \*خطة السداد · Payment plan\*\n💰 السعر: 2,000,000 جنيه/);
  await b.send(".installments 3.5m 10% 8", CLIENT);
  assert.match(b.text(), /💰 السعر: 3,500,000 جنيه/);
});

test("the plan arithmetic", () => {
  assert.equal(calc.monthlyFor(9e6, 2e6, 5), 7e6 / 60);
  assert.deepEqual(calc.downFor(9e6, 1e5, [5]).map((d) => [d.years, d.down]), [[5, 3e6], [7, 6e5], [10, 0]]);
  assert.deepEqual(calc.planGrid(1e6)[0].cells.map((c) => Math.round(c.monthly)), [15000, 10714, 7500]);
});
