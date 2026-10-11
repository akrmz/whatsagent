"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const instances = require("../src/services/instances");
const { toParent } = require("../src/core/connection");
const { makeApp, makeSock, ALL_OFF, BOT } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const NEW = "201198765432";

/** A stand-in for a number's process: no WhatsApp is contacted in tests. */
function fakeSpawner(onSpawn) {
  const spawned = [];
  const fn = (env) => {
    const proc = new EventEmitter();
    proc.exitCode = null;
    proc.killed = false;
    proc.signals = [];
    proc.kill = (sig) => {
      proc.signals.push(sig);
      proc.killed = true;
      proc.exitCode = 0;
      setImmediate(() => proc.emit("exit", 0, sig));
      return true;
    };
    spawned.push({ env, proc });
    if (onSpawn) setImmediate(() => onSpawn(proc, env));
    return proc;
  };
  return { fn, spawned };
}

function bot(t, onSpawn) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }] });
  app.sock = sock;
  app.health.state = "open";
  const spawner = fakeSpawner(onSpawn);
  instances.setSpawner(spawner.fn);
  t.after(() => {
    instances.setSpawner(null);
    instances.running.clear();
  });
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, chat = ME) => d.handleMessage(sock, { key: { id: `N${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? ME : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  const toMe = () => sock.sent.filter((m) => m.jid === ME).map((m) => m.content.text || "");
  return { app, s: app.state, send, spawner, toMe, last: () => toMe().at(-1) || "" };
}

const tick = () => new Promise((r) => setImmediate(r));

test(".numbers add: a separate process with its own folders; its pairing code comes to the owner's private chat only", async (t) => {
  const b = bot(t, (proc) => proc.emit("message", { type: "pairing-code", code: "ABCD-EFGH" }));
  await b.send(".numbers");
  assert.match(b.last(), /^📱 Only this number runs the bot/);
  await b.send(".numbers add 0119 876 5432");
  assert.match(b.last(), /^🔗 \*كود ربط الرقم \+201198765432:\* {2}ABCD-EFGH\n/);
  const { env } = b.spawner.spawned[0];
  const dir = instances.dirOf(b.app.config, NEW);
  assert.deepEqual(
    [env.BOT_INSTANCE, env.DATA_DIR, env.SESSION_DIR, env.HEALTH_PORT, env.PAIRING_NUMBER],
    [NEW, path.join(dir, "data"), path.join(dir, "session"), "0", NEW],
    "its own data and session, no health port, its number for pairing",
  );
  assert.ok(fs.existsSync(path.join(dir, "data")) && fs.existsSync(path.join(dir, "session")));
  await b.send(".numbers");
  assert.match(b.last(), /1\. \+201198765432 — 🔗 waiting for pairing/);

  b.spawner.spawned[0].proc.emit("message", { type: "state", state: "open" });
  assert.match(b.last(), /^✅ الرقم \+201198765432 اتربط وبقى شغال كبوت لوحده/);
  await b.send(".numbers");
  assert.match(b.last(), /— ✅ connected/);
  await b.send(".numbers code 1");
  assert.match(b.last(), /^❌ \+201198765432 is already linked and connected/);

  // Odd messages from the process are ignored.
  b.spawner.spawned[0].proc.emit("message", { type: "pairing-code", code: "<script>" });
  b.spawner.spawned[0].proc.emit("message", "hello");
  await b.send(".numbers");
  assert.match(b.last(), /— ✅ connected/);
});

test("a number that stops on its own is started again, but not forever; stop / start / remove", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-10-11T12:00:00Z") });
  const b = bot(t, (proc) => proc.emit("message", { type: "pairing-code", code: "WXYZ-1234" }));
  await b.send(".numbers add 201198765432");
  for (let i = 1; i <= 5; i++) {
    b.spawner.spawned.at(-1).proc.emit("exit", 1);
    t.mock.timers.tick(60000);
    await tick();
  }
  assert.equal(b.spawner.spawned.length, 6, "restarted 5 times");
  b.spawner.spawned.at(-1).proc.emit("exit", 1);
  t.mock.timers.tick(60000);
  await tick();
  assert.equal(b.spawner.spawned.length, 6, "the 6th stop in 10 minutes: not restarted");
  assert.match(b.last(), /^⚠️ الرقم \+201198765432 وقف 5 مرات في 10 دقايق/);

  await b.send(".numbers start 1");
  assert.equal(b.spawner.spawned.length, 7);
  await b.send(".numbers stop 1");
  assert.deepEqual(b.spawner.spawned.at(-1).proc.signals, ["SIGTERM"]);
  await tick();
  t.mock.timers.tick(60000);
  await tick();
  assert.equal(b.spawner.spawned.length, 7, "stopped by the owner: not restarted");
  assert.ok(b.toMe().some((x) => /stays stopped after a restart/.test(x)));
  assert.ok(b.toMe().some((x) => /كود ربط الرقم \+201198765432:\* {2}WXYZ-1234/.test(x)), "a number started again without a link sends its new code");
  assert.equal(instances.get(b.s, NEW).enabled, false);

  await b.send(".numbers remove 1");
  assert.match(b.last(), /To go ahead: \.numbers remove 201198765432 confirm/);
  await b.send(".numbers remove 1 confirm");
  assert.match(b.last(), /^🗑️ \+201198765432 removed\. Its folder was moved aside on the server: instances\/201198765432\.removed-/);
  assert.equal(instances.get(b.s, NEW), null);
  assert.equal(fs.existsSync(instances.dirOf(b.app.config, NEW)), false, "moved, not left");
  const aside = fs.readdirSync(path.dirname(instances.dirOf(b.app.config, NEW))).find((f) => f.startsWith(`${NEW}.removed-`));
  assert.ok(aside, "kept aside, not deleted");
  t.mock.timers.reset();
});

test(".numbers refuses: a wrong number, the bot's own, twice, more than 5, a group, and inside an extra number", async (t) => {
  const b = bot(t, (proc) => proc.emit("message", { type: "pairing-code", code: "AAAA-BBBB" }));
  await b.send(".numbers add 12");
  assert.match(b.last(), /^❌ Write the number with its country code/);
  await b.send(`.numbers add ${BOT}`);
  assert.match(b.last(), /^❌ That's this bot's own number/);
  await b.send(".numbers add 201198765432");
  await b.send(".numbers add 201198765432");
  assert.match(b.last(), /^❌ \+201198765432 is already added/);
  for (const n of ["201100000001", "201100000002", "201100000003", "201100000004"]) await b.send(`.numbers add ${n}`);
  await b.send(".numbers add 201100000005");
  assert.match(b.last(), /^❌ At most 5 extra numbers/);
  await b.send(".numbers", GROUP);
  assert.match(b.app.sock.sent.at(-1).content.text, /only works in a private chat/);

  process.env.BOT_INSTANCE = "201198765432";
  t.after(() => delete process.env.BOT_INSTANCE);
  await b.send(".numbers add 201100000009");
  assert.match(b.last(), /^This is an extra number run by your main bot/);
  assert.deepEqual(instances.startAll(b.app)(), undefined, "an extra number starts no numbers");
});

test("an extra number reports to the main bot over the process channel only", (t) => {
  const sent = [];
  const had = process.send;
  t.after(() => {
    process.send = had;
    delete process.env.BOT_INSTANCE;
  });
  assert.equal(toParent({ type: "state", state: "open" }), false, "the main bot itself reports to no one");
  process.env.BOT_INSTANCE = "201198765432";
  process.send = (m) => sent.push(m);
  assert.equal(toParent({ type: "pairing-code", code: "ABCD-EFGH" }), true);
  assert.deepEqual(sent, [{ type: "pairing-code", code: "ABCD-EFGH" }]);
});
