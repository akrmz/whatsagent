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
  assert.match(t.last(), /دعاء عشوائي كل ساعتين/);
  assert.ok(t.sock.sent.some((s) => /^🤲/.test(s.content.text || "")), "the first dua is sent right away");
  assert.equal(autopost.get(t.app.state, GROUP).dua.every, 2);
  assert.equal(require("../src/services/azkar").getAuto(t.app.state, GROUP).dua, null);
  await t.send({ text: ".autoazkar dua off", chat: GROUP, sender: USER });
  assert.equal(autopost.get(t.app.state, GROUP), null);
});

// ---- first post right away, next times shown, time zone default --------------------------------

test(".autotafsir every 3 posts the first verse immediately and the next one 3 hours later", async () => {
  const quran = require("../src/services/quran");
  const original = quran.randomAyahTafsir;
  quran.randomAyahTafsir = async () => "📖 FIRST VERSE";
  try {
    const t = realBot();
    const before = Date.now();
    await t.send({ text: ".autotafsir every 3", chat: GROUP, sender: USER });
    const texts = t.sock.sent.map((s) => s.content.text);
    assert.ok(texts.includes("📖 FIRST VERSE"), "first verse sent at once");
    assert.match(t.last(), /⏭️ التالية: .*\(بعد [23] س/);
    const next = autopost.get(t.app.state, GROUP).tafsir.next;
    assert.ok(next >= before + 3 * HOUR && next <= Date.now() + 3 * HOUR);
  } finally {
    quran.randomAyahTafsir = original;
  }
});

test("if the first verse can't be fetched, the loop tries again in a minute", async () => {
  const quran = require("../src/services/quran");
  const original = quran.randomAyahTafsir;
  quran.randomAyahTafsir = async () => {
    throw new Error("offline");
  };
  try {
    const t = realBot();
    const before = Date.now();
    await t.send({ text: ".autotafsir on", chat: GROUP, sender: USER });
    assert.ok(autopost.get(t.app.state, GROUP).tafsir.next <= before + 2 * 60 * 1000);
  } finally {
    quran.randomAyahTafsir = original;
  }
});

test("the shown next time includes quiet hours", () => {
  const zone = "Africa/Cairo";
  const night = Date.parse("2026-10-06T21:00:00Z"); // 00:00 Cairo
  assert.equal(autopost.effectiveNext({ next: night }, "23:00-07:00", zone, night), Date.parse("2026-10-07T04:00:00Z"));
  assert.equal(autopost.effectiveNext({ next: night }, null, zone, night), night);
});

test("on a UTC server without TIMEZONE, the owner's country decides the time zone", () => {
  const { chooseTimezone } = require("../src/config");
  assert.deepEqual(chooseTimezone({ system: "Etc/UTC", ownerNumber: "201012345678" }), { zone: "Africa/Cairo", source: "owner number" });
  assert.deepEqual(chooseTimezone({ system: "UTC", ownerNumber: "966501234567" }), { zone: "Asia/Riyadh", source: "owner number" });
  assert.deepEqual(chooseTimezone({ system: "UTC", ownerNumber: "15551234567" }), { zone: "UTC", source: "server" }, "multi-zone countries are not guessed");
  assert.deepEqual(chooseTimezone({ system: "Europe/Berlin", ownerNumber: "201012345678" }), { zone: "Europe/Berlin", source: "server" }, "a real server zone is kept");
  assert.deepEqual(chooseTimezone({ explicit: "Asia/Tokyo", system: "UTC", ownerNumber: "20" }), { zone: "Asia/Tokyo", source: "TIMEZONE" });
});

test(".autoazkar and .autoprayer say when the next message comes", async () => {
  const azkar = require("../src/services/azkar");
  const adhan = require("../src/services/adhan");
  const noon = Date.parse("2026-10-06T09:00:00Z"); // 12:00 Cairo
  const n = await azkar.nextSend({ morning: "06:30", evening: "17:00", done: {} }, "Africa/Cairo", noon);
  assert.deepEqual([n.kind, n.at, n.inMinutes], ["evening", 17 * 60, 5 * 60]);
  const late = await azkar.nextSend({ morning: "06:30", evening: "17:00", done: {} }, "Africa/Cairo", Date.parse("2026-10-06T19:00:00Z"));
  assert.deepEqual([late.kind, late.inMinutes], ["morning", 8 * 60 + 30], "22:00 → tomorrow 06:30");
  const p = { minutes: 20 * 60, times: { Fajr: 300, Dhuhr: 760, Asr: 965, Maghrib: 1115, Isha: 1190 } };
  assert.deepEqual(adhan.nextPrayer(p), { name: "Fajr", at: 300, inMinutes: 1440 - 1200 + 300 });
});
