"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const BROKER = "201005556666@s.whatsapp.net";
const OWNER = "201001234567@s.whatsapp.net";
const STRANGER = "201009990000@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T09:00:00Z");
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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `B${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const to = (jid) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || "");
  return { app, s: app.state, send, to };
}

test("a unit from a broker (no owner saved) is asked about through the broker; the broker's answer is read", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const fromBroker = { kind: "channel", name: "عقارات الساحل", phones: ["201005556666"] };
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, source: fromBroker }, ME); // #1
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, owner: { name: "أبو أحمد", phone: "201001234567" }, source: fromBroker }, ME); // #2: an owner too

  await b.send(".listing ask 1 2");
  assert.match(b.to(ME).at(-1), /^📤 Asked about #1 \(the broker\), #2: is it still available\?/);
  assert.match(b.to(BROKER).at(-1), /^أهلاً 👋\nبخصوص شاليه في الساحل الشمالي المعروض بـ 9,000,000 جنيه اللي كان معروض عندك \(#1\): لسه متاح؟/);
  assert.match(b.to(OWNER).at(-1), /^أهلاً أبو أحمد 👋\nبخصوص شقة في التجمع/, "with an owner saved, the owner is asked");
  assert.equal(b.to(BROKER).length, 1, "the broker isn't asked about the unit whose owner was");

  await b.send("اتباع", STRANGER);
  assert.equal(b.to(ME).filter((x) => /اتباع/.test(x)).length, 0, "another number's message isn't the answer");
  await b.send("للأسف اتباع امبارح", BROKER);
  assert.equal(b.to(BROKER).at(-1), "شكراً لك 🙏");
  assert.match(b.to(ME).at(-1), /^🔴 السمسار \(\+201005556666\) قال إن #1 شاليه — الساحل الشمالي اتباع\.\n\.listing status 1 sold/);
  t.mock.timers.reset();
});

test("the morning summary points out brokers' units unconfirmed for a week (owners' wait 30 days)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW - 10 * DAY });
  const b = bot();
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل", price: 9e6, source: { kind: "forward", phones: ["201005556666"] } }, ME); // #1 a broker's
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, owner: { phone: "201001234567" } }, ME); // #2 an owner's
  re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6, source: { kind: "channel", name: "x" } }, ME); // #3 no number
  t.mock.timers.setTime(NOW);
  const text = digest.build(b.s, "Africa/Cairo", NOW);
  assert.match(text, /🔗 وحدات سماسرة من غير تأكيد من 7\+ أيام: #1 — اسألهم: \.listing ask 1/);
  assert.doesNotMatch(text, /🔗 وحدات سماسرة[^\n]*#2/, "an owner's unit waits the usual 30 days");
  t.mock.timers.reset();
});
