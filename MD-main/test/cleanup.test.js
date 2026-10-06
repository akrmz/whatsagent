"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const autopost = require("../src/services/autopost");
const azkar = require("../src/services/azkar");
const adhan = require("../src/services/adhan");
const wird = require("../src/services/wird");
const gcschedule = require("../src/services/gcschedule");
const reminders = require("../src/services/reminders");
const captcha = require("../src/services/captcha");
const recap = require("../src/services/recap");
const { makeApp, makeSock, makeMsg, ALL_OFF, BOT } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
const MIN = 60 * 1000;

function realBot(capabilities = ALL_OFF) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities }), capabilities });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, dispatcher, send, last };
}

test("auto posts back off after failures; content outages never stop them, a lost chat does", async () => {
  assert.deepEqual([1, 2, 3, 6, 7, 20].map((n) => autopost.retryDelay(n) / MIN), [10, 20, 40, 320, 360, 360]);

  const t = realBot();
  const start = Date.parse("2026-10-06T07:00:00Z"); // 10:00 Cairo
  autopost.setEvery(t.app.state, GROUP, "tafsir", 3, start);
  autopost.setQuiet(t.app.state, GROUP, null); // only failures move the time here
  const down = { tafsir: async () => Promise.reject(new Error("API down")) };
  let now = start + MIN;
  for (let i = 1; i <= 20; i++) {
    await autopost.runDue(t.app, down, now);
    now = autopost.get(t.app.state, GROUP).tafsir.next;
  }
  const job = autopost.get(t.app.state, GROUP).tafsir;
  assert.equal(job.failures, 20, "still there after 20 content failures");

  // The content is back: posted, counters reset.
  assert.equal(await autopost.runDue(t.app, { tafsir: async () => "📖" }, now), 1);
  assert.equal(autopost.get(t.app.state, GROUP).tafsir.failures, undefined);

  // The bot was removed: sending fails every time → stopped after 12 tries.
  t.sock.sendMessage = async () => Promise.reject(new Error("not-authorized"));
  now = autopost.get(t.app.state, GROUP).tafsir.next;
  let tries = 0;
  while (autopost.get(t.app.state, GROUP)?.tafsir && tries < 50) {
    await autopost.runDue(t.app, { tafsir: async () => "📖" }, now);
    tries++;
    now = autopost.get(t.app.state, GROUP)?.tafsir?.next ?? now;
  }
  assert.equal(tries, autopost.MAX_SEND_FAILURES);
});

test("removing the bot from a group stops everything that ran there", async () => {
  const t = realBot();
  const { state } = t.app;
  const now = Date.now();
  azkar.setAuto(state, GROUP, {});
  adhan.set(state, GROUP, "Cairo");
  autopost.setEvery(state, GROUP, "dua", 4, now);
  autopost.setEvery(state, GROUP, "hadith", 6, now);
  wird.set(state, GROUP, { pages: 2, time: "20:00" });
  gcschedule.set(state, GROUP, "close", "23:00", "Africa/Cairo", now);
  reminders.add(state, { chat: GROUP, sender: ADMIN, text: "meeting", ms: 2 * 3600 * 1000, announce: true, now });
  captcha.set(state, GROUP, { enabled: true });
  recap.record(GROUP, { name: "Ali", text: "hello" });

  // Someone else leaving changes nothing.
  await t.dispatcher.handleEvent("group-participants.update", t.sock, { id: GROUP, participants: [USER], action: "remove" });
  assert.ok(azkar.getAuto(state, GROUP));

  await t.dispatcher.handleEvent("group-participants.update", t.sock, { id: GROUP, participants: [`${BOT}@s.whatsapp.net`], action: "remove" });
  assert.equal(azkar.getAuto(state, GROUP), null);
  assert.equal(adhan.get(state, GROUP), null);
  assert.equal(autopost.get(state, GROUP), null);
  assert.equal(wird.get(state, GROUP), null);
  assert.equal(gcschedule.get(state, GROUP), null);
  assert.equal(reminders.announcementsIn(state, GROUP).length, 0);
  assert.equal(captcha.get(state, GROUP).enabled, false);
  assert.equal(recap.transcript(GROUP, 10, "UTC").count, 0);
});

test(".autos off stops only the Islamic posts; the admin tools stay", async () => {
  const t = realBot();
  const { state } = t.app;
  azkar.setAuto(state, GROUP, {});
  autopost.setEvery(state, GROUP, "tafsir", 3);
  gcschedule.set(state, GROUP, "close", "23:00", "Africa/Cairo");
  await t.send({ text: ".autos off", chat: GROUP, sender: USER });
  assert.match(t.last(), /أُوقفت/);
  assert.match(t.last(), /gcschedule/, "still running, listed");
  assert.equal(azkar.getAuto(state, GROUP), null);
  assert.equal(autopost.get(state, GROUP), null);
  assert.ok(gcschedule.get(state, GROUP));
});

test(".recap summarizes recent messages with the AI; commands are not kept", async () => {
  const t = realBot({ ...ALL_OFF, ai: true });
  let prompt = "";
  t.app.ai = {
    ask: async (p) => {
      prompt = p;
      return "• summary";
    },
  };
  recap.clear(GROUP);
  await t.send({ text: ".recap", chat: GROUP, sender: USER });
  assert.match(t.last(), /لا توجد رسائل كافية/);
  for (let i = 1; i <= 6; i++) await t.send({ text: `message ${i}`, chat: GROUP, sender: USER });
  await t.send({ text: ".ping", chat: GROUP, sender: USER });
  await t.send({ text: ".recap 10", chat: GROUP, sender: USER });
  assert.match(t.last(), /ملخص آخر 6 رسالة/);
  assert.match(t.last(), /• summary/);
  assert.match(prompt, /Tester: message 1/);
  assert.doesNotMatch(prompt, /\.ping|\.recap/);
  await t.send({ text: ".recap 5000", chat: GROUP, sender: USER });
  assert.match(t.last(), /Usage/);

  for (let i = 0; i < 250; i++) recap.record(GROUP, { name: "x", text: "y".repeat(900) });
  const tr = recap.transcript(GROUP, 1000, "UTC");
  assert.equal(tr.count, recap.PER_GROUP, "only the last 200 kept");
  assert.ok(tr.text.split("\n")[0].length < 520, "each message cut to 500 characters");
});
