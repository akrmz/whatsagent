"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
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
  re.setAgent(app.state, "phone", "+20 101 111 2222");
  return { s: app.state, send, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || m.content.caption || "").at(-1) || "" };
}

test("a pasted post's phone number leaves the public description for the private source, however the listing comes in", async () => {
  const b = bot();
  await b.send(".listing add شقة للبيع في التجمع الخامس 150 متر السعر 3.5 مليون\nفيو مفتوح وجراج\nللتواصل 01005556666 واتساب");
  const l = re.get(b.s, 1);
  assert.equal(l.notes.includes("1005556666"), false);
  assert.doesNotMatch(l.notes, /للتواصل|واتساب\s*$/, "no dangling 'للتواصل'");
  assert.match(l.notes, /فيو مفتوح وجراج/, "the rest of the description stays");
  assert.deepEqual([l.source.kind, l.source.phones], ["notes", ["201005556666"]]);
  assert.match(b.last(), /🔗 المصدر \(خاص\): رقم كان في الوصف · \+201005556666/, "shown to you, privately");
  await b.send("#1", CLIENT);
  assert.doesNotMatch(b.last(CLIENT), /1005556666/, "never on the client's card");

  // An edit adding a number: it joins the source too.
  await b.send(".listing edit 1 ملاحظات: المفتاح مع البواب، كلم 0100 777 8888");
  assert.deepEqual(re.get(b.s, 1).source.phones, ["201005556666", "201007778888"]);
  assert.doesNotMatch(re.get(b.s, 1).notes || "", /777/);
});

test("your own number or the owner's is just taken out; prices and sizes aren't numbers to move", async () => {
  const b = bot();
  const l = re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6, notes: "كلمني 01011112222 للمعاينة" }, ME);
  assert.equal(l.source, undefined, "the agent's own number isn't a source");
  assert.doesNotMatch(l.notes || "", /1011112222/);
  const o = re.add(b.s, { type: "شقة", deal: "بيع", location: "المعادي", price: 2e6, owner: { name: "أبو علي", phone: "201002223333" }, notes: "المالك 01002223333" }, ME);
  assert.equal(o.source, undefined, "the owner is already saved");
  const p = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3.5e6, notes: "السعر 3,500,000 أو 3 500 000 · المساحة 150 · الدور 4 · كود 0012" }, ME);
  assert.equal(p.notes, "السعر 3,500,000 أو 3 500 000 · المساحة 150 · الدور 4 · كود 0012");
  assert.equal(p.source, undefined);
});

test("listings saved before 3.70 with numbers in their notes are cleaned at start-up, once, without changing their date", () => {
  const b = bot();
  const id = re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل", price: 9e6 }, ME).id;
  const updated = re.get(b.s, id).updated;
  b.s.store("listings", { seq: 0, items: {} }).update((d) => (d.items[id].notes = "صف أول\nواتساب +20 100 555 6666"));
  assert.equal(re.moveNotePhones(b.s), 1);
  const l = re.get(b.s, id);
  assert.equal(l.notes, "صف أول");
  assert.deepEqual(l.source.phones, ["201005556666"]);
  assert.equal(l.updated, updated);
  assert.equal(re.moveNotePhones(b.s), 0, "idempotent");
});
