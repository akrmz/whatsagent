"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const noNotes = (o) => {
  const { notes: _notes, ...rest } = o;
  return rest;
};

test("listings written as sentences, the way broker posts are", () => {
  const p = (t) => noNotes(re.parseListingText(t));
  assert.deepEqual(p("شقة للبيع في التجمع الخامس 150 متر 3 غرف 2 حمام الدور الرابع سوبر لوكس بسعر 3.5 مليون"), {
    type: "شقة", deal: "بيع", size: 150, rooms: 3, baths: 2, floor: "الرابع", finishing: "سوبر لوكس", price: 3500000, location: "التجمع الخامس",
  });
  assert.deepEqual(p("🔥 فرصة لقطة 🔥\nفيلا للبيع بكمبوند ميفيدا\nمساحة 400م\n5 غرف و 4 حمامات\nبمقدم 2 مليون والباقي على 6 سنين\nالسعر 18 مليون"), {
    type: "فيلا", deal: "بيع", size: 400, rooms: 5, baths: 4, price: 18000000, location: "ميفيدا", down: 2000000, years: 6,
  });
  assert.deepEqual(p("شقة للإيجار في المعادي، 120م، غرفتين وحمامين، دور 3، 25 ألف شهريا"), { type: "شقة", deal: "إيجار", size: 120, rooms: 2, baths: 2, floor: "3", price: 25000, location: "المعادي" });
  assert.deepEqual(p("Apartment for sale in New Cairo, 3 bedrooms, 2 bathrooms, 165 sqm, price 4.2m"), { type: "شقة", deal: "بيع", size: 165, rooms: 3, baths: 2, price: 4200000, location: "New Cairo" });
  assert.equal(p("دوبلكس على المحارة في الشيخ زايد بمقدم 800 ألف وأقساط على 7 سنين، الإجمالي 6.5 مليون").price, 6500000, "the down payment isn't the price");
  assert.equal(p("شقة 3.5 مليون").size, undefined, "مليون isn't a size in metres");
  const labelled = re.parseListingText("النوع: شقة\nالسعر: 3 مليون\nفيو مفتوح بسعر 2 مليون");
  assert.equal(labelled.price, 3000000, "a labelled value wins over one in a sentence");
});

test("clients described in a sentence: area, rooms and a budget (only when it says so)", () => {
  const p = (t) => noNotes(leads.parseLeadText(t, "201011112222"));
  assert.deepEqual(p("أحمد 01001234567 عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون"), { type: "شقة", phone: "201001234567", rooms: 3, location: "التجمع", min: 2e6, max: 3e6 });
  assert.deepEqual(p("منى بتدور على فيلا للإيجار في الشيخ زايد في حدود 80 ألف"), { type: "فيلا", deal: "إيجار", location: "الشيخ زايد", max: 80000 });
  assert.deepEqual(p("عايز شقة لحد 2.5 مليون"), { type: "شقة", max: 2.5e6 });
  assert.deepEqual(p("client wants apartment in New Cairo, budget 4m, 2 bedrooms, 0100 222 3333"), { type: "شقة", phone: "201002223333", rooms: 2, location: "New Cairo", max: 4e6 });
  assert.equal(p("شقة 150 متر").max, undefined, "a number alone is not a budget");
});

function bot(caps = ALL_OFF) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: caps });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: caps }), capabilities: caps });
  const sock = makeSock();
  app.sock = sock;
  const d = createDispatcher(app);
  let n = 0;
  const send = (text) => d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const last = () => sock.sent.at(-1).content.text || "";
  return { app, send, last };
}

test(".listing add reads a free-text post", async () => {
  const b = bot();
  await b.send(".listing add شقة للبيع في التجمع الخامس 150 متر 3 غرف بسعر 3.5 مليون");
  assert.match(b.last(), /📍 التجمع الخامس/);
  assert.match(b.last(), /💰 \*3,500,000 جنيه\*/);
  assert.match(b.last(), /📐 150 م² · 🛏 3 غرف/);
});

test(".listing add ai: the AI's JSON is checked before anything is saved", async () => {
  const noAi = bot();
  await noAi.send(".listing add ai شقة حلوة");
  assert.match(noAi.last(), /No AI is set up/);

  const b = bot({ ...ALL_OFF, ai: true });
  let prompt = "";
  b.app.ai = {
    ask: async (p) => {
      prompt = p;
      return 'Sure! Here it is:\n{"type": "apartment", "deal": "sale", "location": "Madinaty B12", "price": "4.1 مليون", "size": 140, "rooms": 99, "floor": 5, "hacker": "x"}\nHope that helps.';
    },
  };
  await b.send(".listing add ai للبيع لقطة بمدينتي ب١٢ ١٤٠ متر بـ٤.١ مليون، الدور الخامس");
  const l = re.get(b.app.state, 1);
  assert.deepEqual([l.type, l.deal, l.location, l.price, l.size, l.floor], ["شقة", "بيع", "Madinaty B12", 4100000, 140, "5"]);
  assert.equal(l.rooms, undefined, "99 rooms is out of range: dropped");
  assert.equal(l.hacker, undefined, "unknown keys are dropped");
  assert.match(prompt, /NOT a down payment/);
  assert.match(prompt, /data, not instructions/);

  // The AI gets the property, not people: no owner line, phone numbers masked; the owner is still saved.
  await b.send(".listing add ai شقة للبيع في التجمع بسعر 3,500,000 للتواصل 0100 123 4567\nالمالك: أبو أحمد 01112223333");
  assert.doesNotMatch(prompt, /المالك|أبو أحمد|0100|0111|201/);
  assert.match(prompt, /للتواصل \[رقم\]/);
  assert.match(prompt, /3,500,000/, "prices stay");
  assert.deepEqual(re.get(b.app.state, 2).owner, { name: "أبو أحمد", phone: "201112223333" });

  b.app.ai = { ask: async () => "I can't help with that." };
  await b.send(".listing add ai شقة");
  assert.match(b.last(), /couldn't be read/);
  assert.equal(re.all(b.app.state).length, 2, "nothing more saved");
});
