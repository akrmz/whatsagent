"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { createLimiter } = require("../src/core/ratelimit");
const leads = require("../src/services/leads");
const re = require("../src/services/realestate");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const GROUP = "120363000000000012@g.us";
const stranger = (i) => `2010${String(90000000 + i)}@s.whatsapp.net`;

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands: loaded, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `A${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send };
}

test("the sliding window lets max through, then nothing until the window has passed", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const allow = createLimiter({ max: 2, windowMs: 1000 });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("b")], [true, true, false, true]);
  t.mock.timers.setTime(999);
  assert.equal(allow("a"), false);
  t.mock.timers.setTime(1001);
  assert.equal(allow("a"), true);
  t.mock.timers.reset();
});

test('a "#12" or "#rules" flood in a group gets one answer; staff are not limited', async () => {
  const b = bot();
  re.add(b.app.state, { type: "شقة", location: "التجمع", price: 3e6 }, ME);
  await b.send(".save rules Be kind", { chat: GROUP });
  const before = b.sock.sent.length;
  for (let i = 0; i < 20; i++) await b.send("#1", { from: stranger(i % 4), chat: GROUP });
  for (let i = 0; i < 20; i++) await b.send("#rules", { from: stranger(i % 4), chat: GROUP });
  const replies = b.sock.sent.slice(before);
  assert.equal(replies.length, 2, "one listing and one note, not 40 messages");
  for (let i = 0; i < 3; i++) await b.send("#1", { chat: GROUP });
  assert.equal(b.sock.sent.length - before, 5, "the owner can show it as often as needed");
});

test("one person can't make the bot answer more than 5 lookups a minute", async () => {
  const b = bot();
  for (let i = 0; i < 8; i++) re.add(b.app.state, { type: "شقة", location: `منطقة ${i}`, price: 1e6 + i }, ME);
  const before = b.sock.sent.length;
  for (let i = 1; i <= 8; i++) await b.send(`#${i}`, { from: stranger(1), chat: GROUP });
  assert.equal(b.sock.sent.length - before, 5);
});

test("inquiry capture: repeats don't spam the owner, and a crowd of numbers can't fill the client list", async () => {
  const b = bot();
  re.add(b.app.state, { type: "شقة", location: "التجمع", price: 3e6 }, ME);
  re.add(b.app.state, { type: "فيلا", location: "زايد", price: 9e6 }, ME);
  await b.send(".agent autoleads on");
  const bells = () => b.sock.sent.filter((s) => s.jid === ME && /🔔/.test(s.content.text || "")).length;

  await b.send("#1", { from: stranger(1) });
  await b.send("#2", { from: stranger(1) });
  assert.equal(bells(), 1, "one notification per client per hour");
  assert.equal(leads.get(b.app.state, 1).history.length, 2, "both questions are in the history");

  for (let i = 100; i < 140; i++) await b.send("#1", { from: stranger(i) });
  assert.equal(leads.all(b.app.state).length, 30, "at most 30 new clients an hour");
});
