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
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000021@g.us";

function bot(t) {
  let now = Date.parse("2026-10-12T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  const s = app.state;
  const add = (f) => re.add(s, { deal: "بيع", ...f }, ME).id;
  add({ type: "شقة", location: "التجمع الخامس", price: 4e6, size: 160, rooms: 3, owner: { name: "أبو أحمد", phone: "201001234567" } }); // #1
  add({ type: "شقة", location: "التجمع الخامس", price: 3.6e6, size: 150, rooms: 3 }); // #2
  add({ type: "فيلا", location: "الشيخ زايد", price: 2e7, size: 400 }); // #3
  add({ type: "شاليه", location: "الساحل الشمالي", price: 9e6, size: 120 }); // #4
  add({ type: "شاليه", location: "العين السخنة", price: 6e6, size: 110 }); // #5
  let n = 0;
  const send = (text, { from = CLIENT, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "منى", message: { conversation: text } });
  const later = () => t.mock.timers.setTime((now += 60000));
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s, send, later, to };
}

test("a client's \"#1 و #2\" gets the two side by side, the better value marked, and how to see one", async (t) => {
  const b = bot(t);
  await b.send("قارن #1 و #2");
  const text = b.to(CLIENT).at(-1).content.text;
  assert.match(text, /^⚖️ \*مقارنة\* #1 · #2/);
  assert.match(text, /💰 السعر: #1 4 مليون \| #2 3\.6 مليون ✅/);
  assert.match(text, /📐 المساحة: #1 160 م² ✅ \| #2 150 م²/);
  assert.match(text, /ابعت رقم الوحدة زي #1 وتوصلك صورها وتفاصيلها · العملة: جنيه$/);
  assert.doesNotMatch(text, /أبو أحمد|201001234567/, "never the owner");
  t.mock.timers.reset();
});

test("five codes are one line each; unknown codes are left out; one left gets its card", async (t) => {
  const b = bot(t);
  await b.send("#1 #2 #3 #4 #5");
  const text = b.to(CLIENT).at(-1).content.text;
  assert.match(text, /^🏠 \*الوحدات اللي طلبتها:\*\n\n\*#1\* شقة للبيع/);
  assert.equal(text.split("\n").filter((l) => /^\*#\d\*/.test(l)).length, 5);
  b.later();
  await b.send("#3 #99");
  const card = b.to(CLIENT).at(-1).content;
  assert.match(card.text || card.caption, /فيلا للبيع/, "the one that exists: its card");
  assert.doesNotMatch(card.text || card.caption, /⚖️/);
  b.later();
  const before = b.to(CLIENT).length;
  await b.send("#98 #99");
  assert.equal(b.to(CLIENT).length, before, "no listing: nothing");
  t.mock.timers.reset();
});

test("not taken: groups, more words, the same codes twice in 30 seconds; autoleads notes each unit", async (t) => {
  const b = bot(t);
  await b.send("#1 و #2", { chat: GROUP });
  assert.equal(b.to(GROUP).filter((m) => /مقارنة/.test(m.content.text || "")).length, 0, "groups: brokers' chatter");
  await b.send("#1 و #2 اتباعو؟");
  assert.equal(b.to(CLIENT).length, 0, "a sentence: not this");

  await b.send(".agent autoleads on", { from: ME });
  await b.send("#1 و #2");
  await b.send("#1 و #2");
  assert.equal(b.to(CLIENT).filter((m) => /مقارنة/.test(m.content.text || "")).length, 1, "flood: once");
  const lead = leads.byPhone(b.s, "201099998888");
  assert.ok(lead, "saved as a client");
  assert.match(JSON.stringify(lead), /سأل عن العقار #1/);
  assert.match(JSON.stringify(lead), /سأل عن العقار #2/);
  t.mock.timers.reset();
});
