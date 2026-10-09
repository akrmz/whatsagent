"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const english = require("../src/services/english");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `D${++n}`, remoteJid: from, fromMe: false }, pushName: "منى", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "" };
}

test("listings sold in instalments: the down payment (amount or %) and the years are read and shown", () => {
  assert.deepEqual(strip(re.parseListingText("شاليه للبيع في الساحل الشمالي 120 متر السعر 8 مليون مقدم 2 مليون والباقي على 5 سنين")), {
    type: "شاليه", deal: "بيع", size: 120, price: 8e6, location: "الساحل الشمالي", down: 2e6, years: 5,
  });
  assert.deepEqual(strip(re.parseListingText("فيلا للبيع في الشيخ زايد السعر 12 مليون مقدم 25% تقسيط على 72 شهر")), { type: "فيلا", deal: "بيع", price: 12e6, location: "الشيخ زايد", down: 3e6, years: 6 });
  assert.deepEqual(strip(re.parseListingText("النوع: شقة\nالسعر: 3 مليون\nالمقدم: 600 ألف\nالتقسيط: 4 سنين")), { type: "شقة", price: 3e6, down: 6e5, years: 4 });
  assert.deepEqual(strip(re.parseListingText("شقة بسعر 3 مليون مقدم 5 مليون")), { type: "شقة", price: 3e6 }, "a down payment that isn't below the price is a misreading");
  const l = { id: 1, type: "شاليه", deal: "بيع", price: 8e6, down: 2e6, years: 5, status: "available" };
  assert.match(re.card(l, { currency: "جنيه" }), /\n💳 مقدم 2,000,000 جنيه \(25%\) · الباقي على 5 سنين ≈ 100,000 جنيه شهرياً\n/);
  assert.match(english.card(l, { currency: "جنيه" }), /💳 EGP 2,000,000 down \(25%\), the rest over 5 years ≈ EGP 100,000 a month/);
  assert.doesNotMatch(re.card({ ...l, deal: "إيجار" }, { currency: "جنيه" }), /💳/, "not for rentals");
});

test("buyers with a down payment match units whose down payment they can make; cash units need the whole price", () => {
  assert.deepEqual(strip(leads.parseLeadText("عايز شاليه في الساحل معايا مقدم مليون")), { type: "شاليه", location: "الساحل", downMax: 1e6 });
  assert.deepEqual(strip(leads.parseLeadText("عايز فيلا في زايد ميزانية 12 مليون ومقدم 2 مليون")), { type: "فيلا", location: "زايد", downMax: 2e6, max: 12e6 });
  assert.deepEqual(strip(leads.parseLeadText("عايز شقة مقدم في حدود 800 ألف")), { type: "شقة", downMax: 8e5 });
  assert.equal(leads.budgetText({ max: 3e6, downMax: 1e6 }, "جنيه"), "حتى 3 مليون جنيه · مقدم حتى 1 مليون جنيه");

  const plan = { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 8e6, down: 2e6, years: 5, status: "available" };
  const cash = { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 3e6, status: "available" };
  const bigDown = { ...plan, price: 9e6, down: 3e6 };
  const downOnly = { type: "شاليه", location: "الساحل", downMax: 2e6 };
  assert.deepEqual(leads.fits(downOnly, plan), { over: false, byDown: true }, "an 8m chalet with 2m down fits 2m down");
  assert.equal(leads.fits(downOnly, cash), null, "a 3m cash chalet needs 3m now");
  assert.equal(leads.fits(downOnly, bigDown), null, "3m down is more than 2m (+10%)");
  const both = { ...downOnly, max: 4e6 };
  assert.ok(leads.fits(both, cash), "with a 4m budget the cash chalet fits too");
  assert.deepEqual(leads.fits(both, plan), { over: false, byDown: true });
  assert.deepEqual(leads.fits({ type: "شاليه", max: 4e6 }, plan), null, "no down payment said: the full price counts");
});

test("from chat: the card, the client, search filters, matching, and a written request answered by down payment", async () => {
  const b = bot();
  await b.send(".listing add\nشاليه للبيع في الساحل الشمالي 120 متر\nالسعر 8 مليون مقدم 2 مليون والباقي على 5 سنين"); // #1
  assert.match(b.last(), /💳 مقدم 2,000,000 جنيه \(25%\) · الباقي على 5 سنين ≈ 100,000 جنيه شهرياً/);
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 3e6, size: 100 }, ME); // #2: cash
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "العين السخنة", price: 9e6, down: 3e6, years: 6 }, ME); // #3

  await b.send(".listings تقسيط");
  assert.match(b.last(), /^🏠 \*2 available\*/, "only units sold in instalments");
  await b.send(".listings شاليه مقدم 2m");
  assert.match(b.last(), /^🏠 \*1 available\*\n\n[^\n]*#1/);

  await b.send(".lead add\nالاسم: كريم\nالموبايل: 01055554444\nعايز شاليه في الساحل معايا مقدم 2 مليون");
  assert.match(b.last(), /مقدم حتى 2 مليون جنيه/);
  await b.send(".listing match 1");
  assert.match(b.last(), /Clients for #1\* \(1\)[\s\S]*كريم/);
  await b.send(".listing match 2");
  assert.match(b.last(), /No saved client matches #2/, "cash: not for a down-payment buyer");

  re.setAgent(b.s, "requests", "on");
  await b.send("عايز شاليه في الساحل مقدم 2 مليون", CLIENT);
  const answer = b.last(CLIENT);
  assert.match(answer, /#1/);
  assert.doesNotMatch(answer, /#2|#3/);
  assert.equal(leads.byPhone(b.s, "201099998888").downMax, 2e6, "the request saves the down payment");
});
