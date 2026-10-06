"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const hamla = require("../src/services/hamla");
const greetings = require("../src/services/greetings");
const { stopAll } = require("../src/services/automations");
const { at } = require("../src/services/targets");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const A = "447911123456@s.whatsapp.net";
const B = "447911654321@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000004@g.us";

function realBot(env = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo", ...env }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: A }, { id: B }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.filter((s) => !s.content.react).at(-1)?.content?.text || "";
  const reactions = () => sock.sent.filter((s) => s.content.react).length;
  return { app, sock, send, last, reactions };
}

test("dhikr campaign: presets, limits, milestones, finish, undo", () => {
  const t = realBot();
  const s = t.app.state;
  assert.throws(() => hamla.start(s, GROUP, { goal: 5 }), /الهدف من/);
  assert.equal(hamla.start(s, GROUP, { goal: 1000, dhikr: "صلاة" }).dhikr, "اللهم صلِّ وسلم على نبينا محمد");
  assert.equal(hamla.start(s, GROUP, { goal: 1000, dhikr: "" }).dhikr, "أستغفر الله", "istighfar by default");
  assert.equal(hamla.start(s, GROUP, { goal: 1000, dhikr: "سبحان الله العظيم" }).dhikr, "سبحان الله العظيم", "any text");
  assert.equal(hamla.get(s, GROUP).round, 3);

  assert.equal(hamla.add(s, GROUP, A, 200).milestone, null);
  assert.equal(hamla.add(s, GROUP, B, 100).milestone, 25);
  assert.equal(hamla.add(s, GROUP, B, 10).milestone, null, "each milestone once");
  assert.throws(() => hamla.add(s, GROUP, A, 0), /من 1 إلى/);
  assert.throws(() => hamla.add(s, GROUP, A, 20000), /من 1 إلى/);
  assert.equal(hamla.undo(s, GROUP, B), 10);
  assert.throws(() => hamla.undo(s, GROUP, B), /لا توجد إضافة/, "only the last one");
  assert.equal(hamla.get(s, GROUP).total, 300);

  const b = hamla.board(hamla.get(s, GROUP), at);
  assert.match(b.text, /📿 \*حملة سبحان الله العظيم\* \(٣\)/);
  assert.match(b.text, /٣٠٠ من ١٬٠٠٠ · ٢ مشارك/);
  assert.match(b.text, /🥇 @447911123456 — ٢٠٠/);
  assert.deepEqual(b.mentions, [A, B]);

  const r = hamla.add(s, GROUP, A, 700);
  assert.equal(r.finished, true);
  assert.throws(() => hamla.add(s, GROUP, A, 1), /لا توجد حملة جارية/);
  assert.equal(hamla.active(s, GROUP), null);
  assert.match(hamla.board(hamla.get(s, GROUP), at).text, /اكتمل الهدف/);
  assert.equal(hamla.toNumber("١٬٠٠٠"), 1000);
});

test("+100 in the group adds to the campaign with a reaction; milestones and the goal are announced", async () => {
  const t = realBot();
  await t.send({ text: "+100", chat: GROUP, sender: A });
  assert.equal(t.reactions(), 0, "no campaign: ignored");
  await t.send({ text: ".hamla new 400 تسبيح", chat: GROUP, sender: A });
  assert.match(t.last(), /بدأت حملة جديدة/);
  assert.match(t.last(), /سبحان الله وبحمده/);
  const before = t.sock.sent.length;
  await t.send({ text: "+ ٥٠", chat: GROUP, sender: A });
  await t.send({ text: "+40", chat: GROUP, sender: B });
  assert.equal(t.reactions(), 2);
  assert.equal(t.sock.sent.length - before, 2, "no text replies, only reactions");
  await t.send({ text: "+10", chat: GROUP, sender: B });
  assert.match(t.last(), /وصلنا إلى ٢٥٪ من الهدف/);
  await t.send({ text: "+201012345678", chat: GROUP, sender: B });
  assert.equal(hamla.get(t.app.state, GROUP).total, 100, "a phone number is not a count");
  await t.send({ text: ".hamla 300", chat: GROUP, sender: A });
  assert.match(t.last(), /اكتمل الهدف/);
  assert.match(t.last(), /🥇 @447911123456 — ٣٥٠/);

  await t.send({ text: ".hamla new 1000", chat: GROUP, sender: A });
  assert.match(t.last(), /أستغفر الله/, "a finished campaign is replaced without confirm");
  await t.send({ text: "+5", chat: GROUP, sender: A });
  await t.send({ text: ".hamla new 2000 صلاة", chat: GROUP, sender: A });
  assert.match(t.last(), /confirm/);
  await t.send({ text: ".hamla new 2000 صلاة confirm", chat: GROUP, sender: A });
  assert.equal(hamla.get(t.app.state, GROUP).goal, 2000);
  await t.send({ text: ".autos", chat: GROUP, sender: A });
  assert.match(t.last(), /📿 حملة اللهم صلِّ وسلم على نبينا محمد: ٠ من ٢٬٠٠٠/);
  assert.deepEqual(stopAll(t.app.state, GROUP, { all: true }), ["hamla"]);
});

test("group rules: admins set them, everyone reads them, {rules} in the welcome message", async () => {
  const t = realBot();
  await t.send({ text: ".rules", chat: GROUP, sender: A });
  assert.match(t.last(), /No rules are set/);
  await t.send({ text: ".setrules no spam", chat: GROUP, sender: A });
  assert.doesNotMatch(t.last(), /Rules saved/, "members can't set them");
  await t.send({ text: ".setrules 1. Be kind\n2. No spam", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /Rules saved/);
  await t.send({ text: ".rules", chat: GROUP, sender: A });
  assert.match(t.last(), /قوانين المجموعة[\s\S]*1\. Be kind\n2\. No spam/);
  await t.send({ text: "#rules", chat: GROUP, sender: B });
  assert.match(t.last(), /No spam/);

  const msg = await greetings.build(t.app, t.sock, { kind: "welcome", user: A, meta: { id: GROUP, subject: "A$&B {user}", participants: [] }, template: "Hi {user} in {group}\n{rules}" });
  const text = msg.caption || msg.text;
  assert.equal(text, "Hi @447911123456 in A$&B {user}\n1. Be kind\n2. No spam", "values are inserted as written");
  await t.send({ text: ".delrules", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /Rules removed/);
});
