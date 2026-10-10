"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const owners = require("../src/services/owners");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const OWNER = "201001234567@s.whatsapp.net";
const GROUP = "120363000000000011@g.us";
const DAY = 86400 * 1000;

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
  const send = (text, { from = ME, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `O${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "", sentTo: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test("reading owners' answers", () => {
  assert.deepEqual(owners.classify("متاح"), { kind: "available" });
  assert.deepEqual(owners.classify("ايوه لسه موجودة"), { kind: "available" });
  assert.deepEqual(owners.classify("للأسف اتباعت الأسبوع اللي فات"), { kind: "sold" });
  assert.deepEqual(owners.classify("اتأجرت"), { kind: "rented" });
  assert.deepEqual(owners.classify("متاحة بس السعر بقى ٢٫٩ مليون"), { kind: "price", price: 2.9e6 }, "a new price wins over 'available'");
  assert.deepEqual(owners.classify("كلمني بكرة"), { kind: "other" });
  assert.deepEqual(owners.classify("#2 السعر بقى 2.8 مليون"), { kind: "price", price: 2.8e6 }, "'#2' names the listing, it isn't the price");
  assert.deepEqual(re.ownerFrom("أبو أحمد 0100 123 4567", "201011112222"), { name: "أبو أحمد", phone: "201001234567" });
});

test("the owner is private: shown only to staff in their own chat, never to clients or in groups", async () => {
  const b = bot();
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع\nالسعر: 3 مليون\nالمالك: أبو أحمد 01001234567");
  assert.match(b.text(), /🔑 المالك \(خاص\): أبو أحمد \+201001234567/);
  assert.deepEqual(re.get(b.s, 1).owner, { name: "أبو أحمد", phone: "201001234567" });
  assert.doesNotMatch(re.card(re.get(b.s, 1), re.agent(b.s)), /أبو أحمد|201001234567/, "not on the card");

  await b.send(".listing 1");
  assert.match(b.text(), /🔑 المالك \(خاص\)/, "staff, own chat");
  await b.send(".listing 1", { chat: GROUP });
  assert.doesNotMatch(b.text(), /المالك|201001234567/, "the owner's command in a group");
  await b.send(".listing 1", { from: CLIENT });
  assert.doesNotMatch(b.text(), /المالك|201001234567/);
  await b.send("#1", { from: CLIENT });
  assert.doesNotMatch(b.text(), /المالك|201001234567/);

  await b.send(".export listings");
  const csv = b.sock.sent.at(-1).content.document.toString("utf8");
  assert.match(csv, /,owner,source,created,/);
  assert.match(csv, /,أبو أحمد \+201001234567,/);
  const row = re.parseListingText("type: شقة\nowner: أبو أحمد +201001234567");
  assert.deepEqual(row.owner, { name: "أبو أحمد", phone: "201001234567" }, "an export imports back");
});

test(".listing ask: the owner's answer is read and the agent told; asks close after the answer or 7 days", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T09:00:00Z") });
  const b = bot();
  const s = b.s;
  const add = (f) => re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, ...f }, ME);
  add({ owner: { name: "أبو أحمد", phone: "201001234567" } }); // #1
  add({ owner: { name: "أبو أحمد", phone: "201001234567" }, location: "الرحاب" }); // #2 same owner
  add({ owner: { name: "منى" } }); // #3 no number
  const updated = re.get(s, 1).updated;

  await b.send(".listing ask 1 3 9");
  assert.match(b.text(), /📤 Asked about #1: is it still available?/);
  assert.match(b.text(), /⚠️ #3: no owner or broker number/);
  assert.match(b.text(), /⚠️ #9: not found/);
  const q = b.sentTo(OWNER).at(-1).content.text;
  assert.match(q, /^أهلاً أبو أحمد 👋\nبخصوص شقة في التجمع المعروض بـ 3,000,000 جنيه \(#1\): هل ما زال متاحاً؟/);
  assert.equal(re.get(s, 1).updated, updated, "asking doesn't count as an update");
  await b.send(".listing ask 1 2 3 4 5 6");
  assert.match(b.text(), /At most 5 at once/);

  t.mock.timers.setTime(Date.parse("2026-10-08T12:00:00Z"));
  await b.send("ايوه متاحة", { from: OWNER });
  assert.equal(b.sentTo(OWNER).at(-1).content.text, "شكراً لك 🙏");
  assert.match(b.sentTo(ME).at(-1).content.text, /✅ أبو أحمد \(\+201001234567\) أكد إن #1 شقة — التجمع لسه متاح/);
  assert.equal(re.get(s, 1).updated, Date.parse("2026-10-08T12:00:00Z"), "confirmed: counts as freshly updated");
  const n = b.sentTo(OWNER).length;
  await b.send("شكراً", { from: OWNER });
  assert.equal(b.sentTo(OWNER).length, n, "no open question any more: not read as an answer");

  await b.send(".listing ask 1");
  await b.send(".listing ask 2");
  await b.send("اتباعت", { from: OWNER });
  assert.match(b.sentTo(ME).at(-1).content.text, /💬 رد أبو أحمد \(\+201001234567\) على سؤال الإتاحة \(#2، #1\):\n"اتباعت"/, "two open: passed on");
  assert.match(b.sentTo(OWNER).at(-1).content.text, /اكتب رقمها، مثلاً: #2 متاح/);
  await b.send("#2 السعر بقى 2.8 مليون", { from: OWNER });
  assert.match(b.sentTo(ME).at(-1).content.text, /💰 .*السعر الجديد لـ #2 شقة — الرحاب 2,800,000 جنيه \(كان 3,000,000 جنيه\)\.\n\.listing edit 2 السعر: 2\.8 مليون/);
  b.s.setPublic(false);
  await b.send("اتباعت", { from: OWNER });
  assert.match(b.sentTo(ME).at(-1).content.text, /🔴 .* قال إن #1 شقة — التجمع اتباع\.\n\.listing status 1 sold/, "answered in private mode too");
  b.s.setPublic(true);

  await b.send(".listing ask 1");
  t.mock.timers.setTime(Date.now() + 8 * DAY);
  const before = b.sentTo(ME).length;
  await b.send("متاح", { from: OWNER });
  assert.equal(b.sentTo(ME).length, before, "after 7 days the question has closed");
  t.mock.timers.reset();
});

test("the morning summary suggests asking the owners of stale listings", (t) => {
  const now = Date.parse("2026-10-08T06:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: now - 40 * DAY });
  const b = bot();
  re.add(b.s, { type: "شقة", location: "التجمع", price: 3e6, owner: { phone: "201001234567" } }, ME); // #1
  re.add(b.s, { type: "شقة", location: "زايد", price: 4e6 }, ME); // #2 no owner
  t.mock.timers.setTime(now);
  const text = digest.build(b.s, "Africa/Cairo", now);
  assert.match(text, /🕸️ لم تُحدَّث منذ 30\+ يوماً: #2، #1/);
  assert.match(text, /🔑 اسأل الملاك: \.listing ask 1$/m);
  t.mock.timers.reset();
});
