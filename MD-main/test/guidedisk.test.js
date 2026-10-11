"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const digest = require("../src/services/digest");
const storage = require("../src/services/storage");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const MORNING = Date.parse("2026-10-11T05:31:00Z"); // 08:31 in Cairo

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
  const send = (text) => d.handleMessage(sock, { key: { id: `G${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, commands, send, last: () => sock.sent.at(-1)?.content.text || "" };
}

test(".rehelp covers the newer tools, and names only commands that exist", async () => {
  const b = bot();
  await b.send(".rehelp");
  const g = b.last();
  for (const bit of ["listing photo <رقم> cover 3", "listing video <رقم>", "agent watermark on", "agent feedback on", "نبهني 12", "لسه متاحة؟", "lead split", "numbers", "storage clean", "drafts edit"]) assert.ok(g.includes(bit), bit);
  assert.doesNotMatch(g, /—\S|·\.lead/, "the spacing typos are gone");
  const named = [...g.matchAll(/(?:^|[\s(])\.([a-z][a-z0-9]*)/g)].map((m) => m[1]);
  // Against every command, including those that need a tool or key (as the docs check does).
  const all = loadCommands(COMMANDS_DIR, { capabilities: new Proxy({}, { get: () => true, has: () => true }) }).byName;
  const missing = [...new Set(named)].filter((c) => !all.has(c));
  assert.deepEqual(missing, []);
});

test("the morning summary warns when less than 1 GB is free on the disk, and only then", async (t) => {
  const b = bot();
  const real = storage.freeBytes;
  t.after(() => (storage.freeBytes = real));
  t.mock.timers.enable({ apis: ["Date"], now: MORNING - 3600 * 1000 });
  await b.send(".digest on 08:30");
  t.mock.timers.setTime(MORNING);
  storage.freeBytes = () => 600 * 1024 * 1024;
  await digest.runDue(b.app, MORNING);
  assert.match(b.last(), /💾 المساحة الفاضية على السيرفر 600\.0 MB بس — شوف إيه اللي واخد مساحة: \.storage · ونضّف اللي ملوش لازمة: \.storage clean$/);
  storage.freeBytes = () => 20 * 1024 * 1024 * 1024;
  t.mock.timers.setTime(MORNING + 24 * 3600 * 1000);
  await digest.runDue(b.app, MORNING + 24 * 3600 * 1000);
  assert.doesNotMatch(b.last(), /💾 المساحة/);
  t.mock.timers.reset();
});
