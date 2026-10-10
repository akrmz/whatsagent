"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const deals = require("../src/services/deals");
const bytype = require("../src/services/bytype");
const weekly = require("../src/services/weekly");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const NOW = Date.parse("2026-10-10T09:00:00Z");

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
  const send = (text) => d.handleMessage(sock, { key: { id: `T${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, s: app.state, send, text: () => sock.sent.at(-1).content.text || "" };
}

/** 3 apartments, 2 chalets (one sold), no villa available but 2 clients want one. */
function office(t, s) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW - 3 * 86400000 });
  const add = (f) => re.add(s, { deal: "بيع", ...f }, ME).id;
  const a1 = add({ type: "شقة", location: "التجمع", price: 3e6 });
  add({ type: "شقة", location: "التجمع", price: 2.5e6 });
  add({ type: "شقة", location: "المعادي", price: 4e6 });
  const c1 = add({ type: "شاليه", location: "الساحل", price: 9e6 });
  const c2 = add({ type: "شاليه", location: "الساحل", price: 8e6 });
  re.count(s, a1, "views");
  re.count(s, c1, "views");
  re.count(s, c1, "inquiries");
  let n = 0;
  const lead = (f) => leads.add(s, { phone: `20100111000${++n}`, ...f }, ME).id;
  const buyer = lead({ name: "منى", type: "شاليه", deal: "بيع" });
  lead({ name: "علي", type: "فيلا", deal: "بيع" });
  lead({ name: "هاني", type: "فيلا", deal: "بيع" });
  const aptBuyer = lead({ name: "سارة", type: "شقة", deal: "بيع" });
  deals.close(s, buyer, { listing: c2, price: 7.8e6, rate: 2 }, ME);
  deals.close(s, aptBuyer, { listing: a1, price: 2.9e6, rate: 2.5 }, ME);
  t.mock.timers.setTime(NOW);
  return { a1, c1, c2 };
}

test(".restats: each unit type on its own, with a warning when clients want a type that has nothing available", async (t) => {
  const b = bot();
  office(t, b.s);
  await b.send(".restats");
  const r = b.text();
  assert.match(r, /🏷️ \*حسب النوع\*\n▫️ \*شقة\*: ✅ 2 متاح · 🔴 1 مباع\/مؤجر · 👀 1 · ❓ 0 · 👥 0 عميل بيدور · 🤝 1 صفقة\n▫️ \*شاليه\*: ✅ 1 متاح · 🔴 1 مباع\/مؤجر · 👀 1 · ❓ 1 · 👥 0 عميل بيدور · 🤝 1 صفقة\n▫️ \*فيلا\*: مفيش وحدات · 👀 0 · ❓ 0 · 👥 2 عميل بيدور · 🤝 0 صفقة\n {3}⚠️ فيه 2 عميل بيدور على فيلا ومفيش متاح: \.sellers أو \.feed/);
  t.mock.timers.reset();
});

test(".deals and the weekly summary split deals by unit type; a deal keeps its type after its listing is deleted", async (t) => {
  const b = bot();
  const ids = office(t, b.s);
  await b.send(".deals");
  assert.match(b.text(), /🏷️ \*حسب النوع\*\n▫️ شاليه: 1 صفقة · 💰 7\.8 مليون جنيه · 🧾 عمولة 156,000 جنيه\n▫️ شقة: 1 صفقة · 💰 2\.9 مليون جنيه · 🧾 عمولة 72,500 جنيه/);
  const w = weekly.build(b.s, "Africa/Cairo", NOW).split("\n").find((l) => l.startsWith("🏷️ حسب النوع: "));
  assert.deepEqual(w.slice("🏷️ حسب النوع: ".length).split(" | ").sort(), ["شاليه: 1 عميل · 1 صفقة", "شقة: 1 عميل · 1 صفقة", "فيلا: 2 عميل"].sort());

  // The sold chalet's listing is deleted: its deal is still a chalet (saved on the deal).
  re.remove(b.s, b.app.config, ids.c2);
  assert.deepEqual(bytype.deals(b.s, deals.all(b.s)).map((e) => e.type).sort(), ["شاليه", "شقة"]);
  // Deals from before 3.62 have no type: their listing's, else what the client wanted.
  assert.equal(bytype.dealType(b.s, { deal: { listing: ids.a1, price: 1 }, lead: {} }), "شقة");
  assert.equal(bytype.dealType(b.s, { deal: { price: 1 }, lead: { type: "فيلا" } }), "فيلا");
  assert.equal(bytype.dealType(b.s, { deal: { listing: 999, price: 1 }, lead: {} }), "غير محدد");
  t.mock.timers.reset();
});
