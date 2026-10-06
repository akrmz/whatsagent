"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const filters = require("../src/services/filters");
const schedule = require("../src/services/gcschedule");
const quiz = require("../src/services/quiz");
const { pickLanguage } = require("../src/commands/general/tts");
const { makeApp, makeSock, makeMsg, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const BOT_JID = "15550000009@s.whatsapp.net";

function realBot({ env = {}, capabilities = ALL_OFF } = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities }), capabilities });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }, { id: BOT_JID, admin: "admin" }] });
  sock.calls = [];
  sock.groupSettingUpdate = async (jid, setting) => sock.calls.push(["setting", jid, setting]);
  sock.updateBlockStatus = async (jid, action) => sock.calls.push([action, jid]);
  sock.groupFetchAllParticipating = async () => ({ [GROUP]: { id: GROUP, subject: "Test group", participants: [{ id: USER }, { id: BOT_JID, admin: "admin" }] } });
  sock.groupLeave = async (jid) => sock.calls.push(["leave", jid]);
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

// ---- auto-replies -----------------------------------------------------------------------

test("auto-replies match whole words in any language and don't flood the group", async () => {
  const t = realBot();
  await t.send({ text: ".filter hello | Welcome! 👋", chat: GROUP, sender: ADMIN });
  await t.send({ text: ".filter السلام عليكم | وعليكم السلام", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /added/);
  await t.send({ text: ".filter x | y", chat: GROUP, sender: USER });
  assert.match(t.last(), /Only group admins/);

  assert.equal(filters.match(t.app.state, GROUP, "othello is a play"), null, "inside a word: no match");
  assert.equal(filters.match(t.app.state, GROUP, "Hello there!").key, "hello");
  assert.equal(filters.match(t.app.state, GROUP, "يا جماعة السلام عليكم").reply, "وعليكم السلام");

  await t.send({ text: "hello everyone", chat: GROUP, sender: USER });
  assert.equal(t.last(), "Welcome! 👋");
  const count = t.sock.sent.length;
  await t.send({ text: "hello again", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.length, count, "not repeated right away");
  assert.throws(() => filters.add(t.app.state, GROUP, ".ping", "x"), /can't start with/);
});

// ---- scheduled open/close ------------------------------------------------------------------

test("group schedule runs once a day at the set time (and a time already passed starts tomorrow)", async () => {
  const t = realBot({ env: { TIMEZONE: "Africa/Cairo" } });
  const noon = Date.parse("2026-10-06T09:00:00Z"); // 12:00 in Cairo
  assert.equal(schedule.set(t.app.state, GROUP, "close", "11 pm", "Africa/Cairo", noon), "23:00");
  assert.equal(schedule.set(t.app.state, GROUP, "open", "08:00", "Africa/Cairo", noon), "08:00");
  assert.equal(schedule.set(t.app.state, GROUP, "open", "nonsense", "Africa/Cairo", noon), null);
  const entry = schedule.get(t.app.state, GROUP);
  assert.deepEqual(schedule.dueActions(entry, "Africa/Cairo", noon), [], "08:00 already passed today: not now");

  const at2301 = Date.parse("2026-10-06T20:01:00Z"); // 23:01 Cairo
  assert.equal(await schedule.runDue(t.app, at2301), 1);
  assert.deepEqual(t.sock.calls.at(-1), ["setting", GROUP, "announcement"]);
  assert.match(t.last(), /closed.*until 08:00/);
  assert.equal(await schedule.runDue(t.app, at2301 + 60000), 0, "only once a day");

  const at0805 = Date.parse("2026-10-07T05:05:00Z"); // 08:05 Cairo next day
  assert.equal(await schedule.runDue(t.app, at0805), 1);
  assert.deepEqual(t.sock.calls.at(-1), ["setting", GROUP, "not_announcement"]);
});

// ---- games -------------------------------------------------------------------------------

test("math quiz: first correct number wins points; late or wrong answers don't", async () => {
  const t = realBot();
  await t.send({ text: ".mathquiz", chat: GROUP, sender: USER });
  const round = quiz.active(GROUP);
  assert.ok(round);
  assert.match(t.last(), /= \?/);
  await t.send({ text: String(round.a + 1), chat: GROUP, sender: ADMIN });
  assert.ok(quiz.active(GROUP), "wrong answer keeps the round open");
  await t.send({ text: String(round.a), chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /got it in .*\(\+1, total 1\)/);
  assert.equal(quiz.active(GROUP), null);

  const r2 = quiz.start("other-chat", "hard", 1000);
  assert.equal(quiz.answer("other-chat", String(r2.a), 1000 + quiz.ROUND_MS + 1), null, "too late");
  assert.equal(quiz.expire("other-chat", r2), true);
});

test("rock paper scissors understands words, emoji and Arabic", async () => {
  const t = realBot();
  for (const move of ["rock", "✂️", "ورقة"]) {
    await t.send({ text: `.rps ${move}`, chat: USER });
    assert.match(t.last(), /You: .* vs {2}Me: .*\n(🤝 Draw!|🎉 You win!|😎 I win!)/);
  }
});

// ---- owner tools, availability messages ------------------------------------------------------

test("owner group tools: list, leave by number, block (never the owner)", async () => {
  const t = realBot();
  await t.send({ text: ".groups", chat: OWNER_JID });
  assert.match(t.last(), /1\. \*Test group\* · 2 members · 👮 admin/);
  await t.send({ text: ".leavegroup 1", chat: OWNER_JID });
  assert.deepEqual(t.sock.calls.at(-1), ["leave", GROUP]);
  await t.send({ text: `.block ${OWNER}`, chat: OWNER_JID });
  assert.match(t.last(), /owner can't be blocked/);
  await t.send({ text: ".block 447911123456", chat: OWNER_JID });
  assert.deepEqual(t.sock.calls.at(-1), ["block", USER]);
  await t.send({ text: ".groups", chat: USER });
  assert.match(t.last(), /only for the bot owner/);
});

test("a command that is off because a tool is missing says so (the owner also sees why)", async () => {
  const t = realBot();
  await t.send({ text: ".play adele", chat: USER });
  assert.equal(t.last(), "⚠️ .song isn't available on this bot right now.");
  await t.send({ text: ".song adele", chat: OWNER_JID });
  assert.match(t.last(), /It needs: ytdlp, ffmpeg\. Send \.doctor/);
  await t.send({ text: ".help video", chat: USER });
  assert.match(t.last(), /\.video isn't available/);
});

test(".tts picks the language from a code: prefix or from the script", () => {
  assert.deepEqual(pickLanguage("hi there"), { lang: "en", text: "hi there" }, "'hi' is not read as Hindi");
  assert.deepEqual(pickLanguage("fr: Bonjour"), { lang: "fr", text: "Bonjour" });
  assert.equal(pickLanguage("صباح الخير").lang, "ar");
  assert.equal(pickLanguage("Привет").lang, "ru");
});

test("animated stickers become GIFs; static ones are refused", async () => {
  const sharp = require("sharp");
  const frames = [];
  for (const c of ["#f00", "#0f0", "#00f"]) frames.push(await sharp({ create: { width: 64, height: 64, channels: 4, background: c } }).png().toBuffer());
  const animated = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
  const still = await sharp(frames[0]).webp().toBuffer();
  const [, togif] = require("../src/commands/sticker/animated");
  const run = async (buf) => {
    const sent = [];
    await togif.run({ prefix: ".", commandName: "togif", findMedia: () => ({ type: "sticker" }), download: async () => buf, reply: async (p) => sent.push(p) });
    return sent[0];
  };
  const out = await run(animated);
  const meta = await sharp(out.document, { animated: true }).metadata();
  assert.equal(meta.format, "gif");
  assert.equal(meta.pages, 3);
  await assert.rejects(run(still), /isn't animated/);
});
