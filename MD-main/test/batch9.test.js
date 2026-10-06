"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const captcha = require("../src/services/captcha");
const azkar = require("../src/services/azkar");
const autopost = require("../src/services/autopost");
const wird = require("../src/services/wird");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const NEW = "447911999999@s.whatsapp.net";
const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const BOT_JID = "15550000009@s.whatsapp.net";

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }, { id: NEW }, { id: BOT_JID, admin: "admin" }] });
  sock.removed = [];
  sock.groupParticipantsUpdate = async (jid, users, action) => sock.removed.push([action, ...users]);
  sock.profilePictureUrl = async () => null;
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const join = (user, author) => dispatcher.handleEvent("group-participants.update", sock, { id: GROUP, participants: [user], action: "add", author });
  const texts = () => sock.sent.map((s) => s.content.text).filter(Boolean);
  return { app, sock, send, join, texts };
}

test("captcha: a member who joins by link must answer; the right answer verifies them", async () => {
  const t = realBot();
  await t.send({ text: ".captcha on", chat: GROUP, sender: ADMIN });
  await t.join(NEW);
  const question = t.texts().find((x) => x.includes("اكتب ناتج"));
  const [, a, b] = question.match(/\*(\d+) \+ (\d+)\*/);
  assert.ok(captcha.isPending(GROUP, NEW));

  await t.send({ text: "hello everyone", chat: GROUP, sender: NEW });
  assert.ok(t.sock.sent.at(-1).content.delete, "other messages are deleted until they answer");
  await t.send({ text: String(Number(a) + Number(b)), chat: GROUP, sender: NEW });
  assert.match(t.texts().at(-1), /تم التحقق/);
  assert.equal(captcha.isPending(GROUP, NEW), false);
  await t.send({ text: ".flip", chat: GROUP, sender: NEW });
  assert.match(t.texts().at(-1), /Heads|Tails/, "after verifying, commands work");
});

test("captcha: three wrong answers remove the member; Arabic digits count", async () => {
  const t = realBot();
  captcha.set(t.app.state, GROUP, { enabled: true });
  await t.join(USER);
  for (let i = 0; i < 3; i++) await t.send({ text: "999", chat: GROUP, sender: USER });
  assert.deepEqual(t.sock.removed.at(-1), ["remove", USER]);
  assert.equal(captcha.isPending(GROUP, USER), false);

  await t.join(NEW);
  const q = t.texts().reverse().find((x) => x.includes("اكتب ناتج"));
  const [, a, b] = q.match(/\*(\d+) \+ (\d+)\*/);
  const arabic = String(Number(a) + Number(b)).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  await t.send({ text: arabic, chat: GROUP, sender: NEW });
  assert.match(t.texts().at(-1), /تم التحقق/);
});

test("captcha: members added by an admin are trusted", async () => {
  const t = realBot();
  captcha.set(t.app.state, GROUP, { enabled: true });
  await t.join(NEW, ADMIN);
  assert.equal(captcha.isPending(GROUP, NEW), false);
  assert.ok(!t.texts().some((x) => x.includes("اكتب ناتج")));
});

test(".autos lists the automatic posts and stops them all", async () => {
  const t = realBot();
  const chat = "447911555555@s.whatsapp.net";
  azkar.setAuto(t.app.state, chat, {});
  autopost.setEvery(t.app.state, chat, "hadith", 6);
  wird.set(t.app.state, chat, { pages: 2, time: "20:00" });
  await t.send({ text: ".autos", chat });
  const list = t.texts().at(-1);
  assert.match(list, /أذكار الصباح والمساء/);
  assert.match(list, /حديث كل 6 ساعات/);
  assert.match(list, /الورد اليومي: صفحتان/);
  await t.send({ text: ".autos off", chat });
  assert.equal(azkar.getAuto(t.app.state, chat), null);
  assert.equal(autopost.get(t.app.state, chat), null);
  assert.equal(wird.get(t.app.state, chat), null);
  await t.send({ text: ".autos", chat });
  assert.match(t.texts().at(-1), /لا يوجد شيء تلقائي/);
});
