"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const DAY = 86400000;

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `I${++n}`, remoteJid: from, fromMe: false }, pushName: "Mona", message: { conversation: text } });
  const last = () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "";
  return { app, sock, send, last };
}

test("price history: a recent cut shows as a discount for 30 days; increases don't", (t) => {
  const b = bot();
  const s = b.app.state;
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T10:00:00Z") });
  const l = re.add(s, { type: "شقة", location: "التجمع", price: 3600000 }, ME);
  re.update(s, l.id, { price: 3200000 });
  assert.match(re.card(re.get(s, l.id), { currency: "جنيه" }), /💰 \*3,200,000 جنيه\* \(3\.2 مليون\)\n📉 كان 3,600,000 جنيه — خصم 11%/);
  re.update(s, l.id, { notes: "فيو مفتوح" });
  assert.equal(re.get(s, l.id).priceHistory.length, 1, "other edits don't add history");
  t.mock.timers.setTime(Date.parse("2026-11-08T10:00:00Z"));
  assert.equal(re.discount(re.get(s, l.id)), null, "after 30 days it's just the price");
  re.update(s, l.id, { price: 3400000 });
  assert.equal(re.discount(re.get(s, l.id)), null, "an increase is not a discount");
  for (let i = 0; i < 15; i++) re.update(s, l.id, { price: 3000000 + i * 1000 });
  assert.equal(re.get(s, l.id).priceHistory.length, 10, "the last 10 prices are kept");
  t.mock.timers.reset();
});

test("interest counters: client views, inquiries and sends; staff views don't count and nothing changes 'updated'", async () => {
  const b = bot();
  const s = b.app.state;
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع\nالسعر: 3 مليون");
  const updated = re.get(s, 1).updated;
  await b.send(".listing 1"); // the owner: not counted
  await b.send(".agent autoleads on");
  await b.send("#1", CLIENT); // a client: a view and an inquiry
  await b.send(".lead send 1 1");
  assert.deepEqual(re.get(s, 1).stats, { views: 1, inquiries: 1, sent: 1 });
  assert.equal(re.get(s, 1).updated, updated, "counting doesn't make a listing look fresh");
});

test("stale listings appear in the digest and the report; .restats shows sources, conversion and days to a deal", async (t) => {
  const b = bot();
  const s = b.app.state;
  const now = Date.parse("2026-10-08T06:00:00+03:00");
  t.mock.timers.enable({ apis: ["Date"], now: now - 40 * DAY });
  re.add(s, { type: "فيلا", location: "زايد", price: 9e6 }, ME); // added 40 days ago, never touched
  const a = leads.add(s, { name: "أحمد", phone: "201001234567", source: "فيسبوك" }, ME);
  leads.add(s, { name: "منى", phone: "201002223333", source: "فيسبوك" }, ME);
  leads.add(s, { name: "سارة", phone: "201003334444", source: "إحالة" }, ME);
  t.mock.timers.setTime(now - 10 * DAY);
  leads.update(s, a.id, { status: "won" }); // a deal 30 days after first contact
  t.mock.timers.setTime(now);
  re.add(s, { type: "شقة", location: "التجمع", price: 3e6 }, ME);
  re.count(s, 2, "views");
  re.count(s, 2, "inquiries");

  assert.deepEqual(re.stale(s, 30).map((l) => l.id), [1]);
  assert.match(digest.build(s, "Africa/Cairo", now), /🕸️ لم تُحدَّث منذ 30\+ يوماً: #1 — هل ما زالت متاحة؟/);

  await b.send(".restats");
  const r = b.last();
  assert.match(r, /🔥 \*الأكثر طلباً\*\n\*#2\* شقة — التجمع: 👀 1 · ❓ 1/);
  assert.match(r, /🕸️ \*لم تُحدَّث منذ 30\+ يوماً \(1\)\*: #1/);
  assert.match(r, /▫️ فيسبوك: 2 عميل · ✅ 1 صفقة \(50%\)/);
  assert.match(r, /▫️ إحالة: 1 عميل · ✅ 0 صفقة \(0%\)/);
  assert.match(r, /الصفقات: 1 من 3 \(33%\) · متوسط المدة حتى الصفقة: 30 يوم/);
  await b.send(".restats", CLIENT);
  assert.doesNotMatch(b.last(), /تقرير التسويق/, "owner and sudo only");
  t.mock.timers.reset();
});
