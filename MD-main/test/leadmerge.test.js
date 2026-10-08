"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

test("one number, one client: an edit can't give a client someone else's number", async () => {
  const b = bot();
  leads.add(b.s, { name: "أحمد", phone: "201001110001" }, ME);
  leads.add(b.s, { name: "منى" }, ME);
  await b.send(".lead edit 2 الموبايل: 01001110001");
  assert.match(b.text(), /\+201001110001 is already client #1 \(أحمد\)\. If it's the same person: \.lead merge 1 2/);
  assert.equal(leads.get(b.s, 2).phone, undefined);
  await b.send(".lead edit 1 الموبايل: 01001110001");
  assert.doesNotMatch(b.text(), /already client/, "its own number again is fine");
});

test(".lead merge folds a duplicate in: fields, history, sends, deals, viewings, and a stop request", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T10:00:00Z") });
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); // #1
  leads.add(s, { name: "أحمد علي", phone: "201001110001", notes: "أول تواصل" }, ME); // #1
  t.mock.timers.setTime(Date.parse("2026-10-02T10:00:00Z"));
  leads.add(s, { name: "احمد على", type: "شقة", location: "التجمع", max: 3.5e6, notes: "من إعلان فيسبوك" }, ME); // #2: the same man, no number
  leads.markSent(s, 2, 1, ME, "أُرسل له العقار #1");
  leads.setOptOut(s, 2, true);
  t.mock.timers.setTime(Date.parse("2026-10-03T10:00:00Z"));
  viewings.add(s, { lead: 2, listing: 1, at: Date.parse("2026-10-05T13:00:00Z"), chat: ME, by: ME });

  await b.send(".lead merge 1 2");
  assert.match(b.text(), /^🔗 Client #2 merged into #1 \(1 viewing\(s\) moved\)\./);
  assert.equal(leads.get(s, 2), null);
  const m = leads.get(s, 1);
  assert.deepEqual([m.name, m.phone, m.type, m.location, m.max], ["أحمد علي", "201001110001", "شقة", "التجمع", 3.5e6], "its own fields kept, missing ones filled");
  assert.deepEqual(m.history.map((h) => h.text), ["أول تواصل", "من إعلان فيسبوك", "أُرسل له العقار #1", "طلب إيقاف رسائل العروض (وقف)", "دُمج معه العميل #2"], "both histories, in time order");
  assert.deepEqual(m.sentListings, [1]);
  assert.equal(m.optedOut, true, "a stop request on either record holds");
  assert.equal(viewings.upcoming(s)[0].lead, 1);

  await b.send(".lead merge 1 1");
  assert.match(b.text(), /Those are the same client/);
  await b.send(".lead merge 1 9");
  assert.match(b.text(), /There is no client #9/);
  t.mock.timers.reset();
});

test(".leads dupes: the same name in other spellings, the same number; two numbers mean two people", async () => {
  const b = bot();
  leads.add(b.s, { name: "أحمد علي", phone: "201001110001" }, ME); // #1
  leads.add(b.s, { name: "احمد  على" }, ME); // #2, no number: likely #1
  leads.add(b.s, { name: "منى", phone: "201001110003" }, ME); // #3
  leads.add(b.s, { name: "منى", phone: "201001110004" }, ME); // #4: another Mona
  await b.send(".leads dupes");
  const r = b.text();
  assert.match(r, /^👥 \*Possible duplicates\* \(1\)\n\n🔤 same name: #1 أحمد علي \(\+201001110001\) · #2 احمد {2}على \(no number\)\n {3}\.lead merge 1 2/);
  assert.doesNotMatch(r, /منى/);
  await b.send(".lead merge 1 2");
  await b.send(".leads dupes");
  assert.match(b.text(), /No duplicate clients found/);
});
