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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `F${++n}`, remoteJid: from, fromMe: false }, pushName: "منى", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "" };
}

test("features are read in their usual spellings, never from look-alikes, and shown on the cards", () => {
  assert.deepEqual(re.featuresIn("شاليه للبيع في مراسي صف أول فيو بحر مفروش بالكامل"), ["صف أول", "فيو بحر", "مفروش"]);
  assert.deepEqual(re.featuresIn("فيلا بحمام سباحة خاص وجنينة وجراج"), ["حمام سباحة", "جاردن", "جراج"]);
  assert.deepEqual(re.featuresIn("شقة ببيسين وروف استلام فوري ناصية"), ["حمام سباحة", "روف", "استلام فوري", "ناصية"]);
  assert.deepEqual(re.featuresIn("Chalet first row, sea view, private pool"), ["صف أول", "فيو بحر", "حمام سباحة"]);
  assert.deepEqual(re.featuresIn("شقة الدور الأول 2 حمام في كمبوند الروفي"), [], "the first floor, bathrooms and a compound named الروفي aren't features");
  const f = re.parseListingText("شاليه للبيع في مراسي صف أول فيو بحر 120 متر السعر 9 مليون");
  assert.deepEqual([f.location, f.features], ["مراسي", ["صف أول", "فيو بحر"]], "and the location stops before them");
  const l = { id: 1, type: "شاليه", deal: "بيع", location: "مراسي", price: 9e6, features: ["صف أول", "فيو بحر"], status: "available" };
  assert.match(re.card(l, { currency: "جنيه" }), /\n⭐ صف أول · فيو بحر\n/);
  assert.match(english.card(l, { currency: "جنيه" }), /⭐ first row · sea view/);
  assert.deepEqual(re.featuresOf({ notes: "فيلا بحمام سباحة", location: "زايد" }), ["حمام سباحة"], "older listings: read from their notes");
});

test("clients' must-haves: only units with all of them match; search by feature; .listing edit adds features", async () => {
  const b = bot();
  await b.send(".listing add\nشاليه للبيع في الساحل الشمالي صف أول فيو بحر 120 متر السعر 9 مليون"); // #1
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 7e6, notes: "صف تاني فيو بحر" }, ME); // #2: second row
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 5e6 }, ME); // #3: nothing said

  await b.send(".lead add\nالاسم: كريم\nالموبايل: 01055554444\nعايز شاليه صف أول على البحر مباشرة في الساحل ميزانية 10 مليون");
  assert.match(b.last(), /شاليه في الساحل \(صف أول، فيو بحر\)/);
  const karim = leads.byPhone(b.s, "201055554444");
  assert.deepEqual(karim.features, ["صف أول", "فيو بحر"]);
  assert.deepEqual(leads.matchingListings(b.s, karim).map((m) => m.listing.id), [1], "the second-row and the unknown chalets don't match");
  await b.send(".listing match 3");
  assert.match(b.last(), /No saved client matches #3/);

  await b.send(".listings شاليه صف أول");
  assert.match(b.last(), /^🏠 \*1 available\*\n\n[^\n]*#1/);
  await b.send(".listings فيو بحر");
  assert.match(b.last(), /^🏠 \*2 available\*/, "#2 says فيو بحر in its notes");

  await b.send(".listing edit 3 المميزات: صف أول وفيو بحر وجراج");
  assert.deepEqual(re.get(b.s, 3).features, ["صف أول", "فيو بحر", "جراج"]);
  await b.send(".listing edit 3 مفروش");
  assert.deepEqual(re.get(b.s, 3).features, ["صف أول", "فيو بحر", "جراج", "مفروش"], "an edit adds to them");
  assert.deepEqual(leads.matchingListings(b.s, karim).map((m) => m.listing.id).sort(), [1, 3]);

  re.setAgent(b.s, "requests", "on");
  await b.send("عايز شاليه في الساحل بجراج", CLIENT);
  assert.match(b.last(CLIENT), /#3/);
  assert.doesNotMatch(b.last(CLIENT), /#1|#2/);
  assert.deepEqual(leads.byPhone(b.s, "201099998888").features, ["جراج"], "the request saves the must-have");

  assert.deepEqual(assistant.parseWants("type=فيلا; features=حمام سباحة، جنينة، كذا"), { type: "فيلا", features: ["حمام سباحة", "جاردن"] }, "the assistant's wishes too (unknown ones dropped)");
});
