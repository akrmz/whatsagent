"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const autopost = require("../src/services/autopost");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const HOUR = 3600 * 1000;

function realBot(env = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo", ...env }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

const builders = { tafsir: async () => "📖 tafsir", dua: async () => "🤲 dua" };

test("Arabic hour wording and quiet-hour maths", () => {
  assert.deepEqual([1, 2, 3, 10, 12].map(autopost.everyHoursAr), ["كل ساعة", "كل ساعتين", "كل 3 ساعات", "كل 10 ساعات", "كل 12 ساعة"]);
  assert.deepEqual(autopost.parseQuiet("23:00-07:00"), { start: 1380, end: 420 });
  assert.equal(autopost.parseQuiet("nonsense"), null);
  assert.equal(autopost.quietLeft("23:00-07:00", 2 * 60), 5 * 60, "02:00 → 5 h left");
  assert.equal(autopost.quietLeft("23:00-07:00", 12 * 60), 0);
  assert.equal(autopost.quietLeft("13:00-14:00", 13 * 60 + 30), 30);
  assert.equal(autopost.quietLeft(null, 2 * 60), 0);
});

test("a verse with tafsir every 3 hours, held during quiet hours, retried after a failure", async () => {
  const t = realBot();
  const start = Date.parse("2026-10-06T07:00:00Z"); // 10:00 Cairo
  autopost.setEvery(t.app.state, GROUP, "tafsir", 3, start);
  assert.equal(await autopost.runDue(t.app, builders, start), 0, "first one a minute later");
  assert.equal(await autopost.runDue(t.app, builders, start + 61 * 1000), 1);
  assert.equal(t.last(), "📖 tafsir");
  assert.equal(await autopost.runDue(t.app, builders, start + 2 * HOUR), 0, "not before 3 h");
  assert.equal(await autopost.runDue(t.app, builders, start + 3 * HOUR + 2 * 60 * 1000), 1, "13:02 Cairo");

  // 23:30 Cairo: due but quiet → held until 07:00.
  const late = Date.parse("2026-10-06T20:30:00Z");
  assert.equal(await autopost.runDue(t.app, builders, late), 0);
  assert.equal(autopost.get(t.app.state, GROUP).tafsir.next, Date.parse("2026-10-07T04:00:00Z"), "07:00 Cairo");

  // The Quran API fails: retried 10 minutes later, nothing lost.
  const morning = Date.parse("2026-10-07T04:00:00Z");
  const failing = { ...builders, tafsir: async () => Promise.reject(new Error("down")) };
  assert.equal(await autopost.runDue(t.app, failing, morning), 0);
  assert.equal(autopost.get(t.app.state, GROUP).tafsir.next, morning + 10 * 60 * 1000);
});

test(".autotafsir: any member can set it by default; hours 1-24; quiet hours; off", async () => {
  const t = realBot();
  await t.send({ text: ".autotafsir every 3", chat: GROUP, sender: USER });
  assert.match(t.last(), /كل 3 ساعات/);
  assert.equal(autopost.get(t.app.state, GROUP).tafsir.every, 3);
  await t.send({ text: ".autotafsir every 48", chat: GROUP, sender: USER });
  assert.match(t.last(), /من 1 إلى 24/);
  await t.send({ text: ".autotafsir quiet 22:00-06:00", chat: GROUP, sender: USER });
  assert.equal(autopost.get(t.app.state, GROUP).quiet, "22:00-06:00");
  await t.send({ text: ".autotafsir quiet off", chat: GROUP, sender: USER });
  assert.equal(autopost.get(t.app.state, GROUP).quiet, null);
  await t.send({ text: ".autotafsir off", chat: GROUP, sender: USER });
  assert.equal(autopost.get(t.app.state, GROUP), null);

  const strict = realBot({ ISLAMIC_ADMIN_ONLY: "true" });
  await strict.send({ text: ".autotafsir every 3", chat: GROUP, sender: USER });
  assert.match(strict.last(), /المشرفون فقط/);
  await strict.send({ text: ".autotafsir every 3", chat: GROUP, sender: ADMIN });
  assert.match(strict.last(), /كل 3 ساعات/);
});

test(".autoazkar dua every 2: a random dua every 2 hours, replacing the once-a-day dua", async () => {
  const t = realBot();
  await t.send({ text: ".autoazkar on", chat: GROUP, sender: USER });
  await t.send({ text: ".autoazkar dua 21:00", chat: GROUP, sender: USER });
  await t.send({ text: ".autoazkar dua every 2", chat: GROUP, sender: USER });
  assert.match(t.last(), /دعاءً عشوائياً كل ساعتين/);
  assert.equal(autopost.get(t.app.state, GROUP).dua.every, 2);
  assert.equal(require("../src/services/azkar").getAuto(t.app.state, GROUP).dua, null);
  await t.send({ text: ".autoazkar dua off", chat: GROUP, sender: USER });
  assert.equal(autopost.get(t.app.state, GROUP), null);
});
