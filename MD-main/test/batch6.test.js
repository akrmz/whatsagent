"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const levels = require("../src/services/levels");
const cards = require("../src/services/cards");
const jobs = require("../src/core/jobs");
const notices = require("../src/services/notices");
const { groupData } = require("../src/services/settings");
const { makeApp, makeSock, makeMsg, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const BOT_JID = "15550000009@s.whatsapp.net";

function realBot({ env = {} } = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }, { id: BOT_JID, admin: "admin" }] });
  sock.profilePictureUrl = async () => null;
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, dispatcher, send, last };
}

// ---- levels ---------------------------------------------------------------------------

test("level maths: thresholds grow, leftover XP carries over", () => {
  assert.deepEqual(levels.levelOf(0), { level: 0, current: 0, needed: 100 });
  assert.deepEqual(levels.levelOf(100), { level: 1, current: 0, needed: 155 });
  assert.deepEqual(levels.levelOf(300), { level: 2, current: 45, needed: 220 });
});

test("XP is earned at most once a minute per person, and .rank sends a card", async () => {
  const t = realBot();
  await t.send({ text: "hi all", chat: GROUP, sender: USER });
  const first = levels.stats(t.app.state, GROUP, USER).xp;
  assert.ok(first >= 15 && first <= 25);
  await t.send({ text: "spam spam", chat: GROUP, sender: USER });
  assert.equal(levels.stats(t.app.state, GROUP, USER).xp, first, "no XP within a minute");
  await t.send({ text: ".rank", chat: GROUP, sender: USER });
  const sent = t.sock.sent.at(-1).content;
  assert.ok(Buffer.isBuffer(sent.image));
  assert.match(sent.caption, /level 0 · rank #1/);
  await t.send({ text: ".leaderboard", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /🥇 @447911123456 — level 0/);
});

test("level-up announcements are opt-in", async () => {
  const t = realBot();
  levels.setAnnounce(t.app.state, GROUP, true);
  // ADMIN: the XP cooldown is per process and USER already chatted in the previous test.
  t.app.state.store("levels", {}).update((d) => (d[GROUP] = { [ADMIN]: 99 }));
  await t.send({ text: "one more message", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /reached \*level 1\*/);
});

// ---- cards ------------------------------------------------------------------------------

test("welcome and rank cards are drawn locally, with unsafe text escaped", async () => {
  const sharp = require("sharp");
  const welcome = await cards.welcomeCard({ avatar: null, kind: "welcome", name: '<script>"x"</script> & 🎉', group: "مجموعة", members: 5 });
  const meta = await sharp(welcome).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1000);
  const rank = await cards.rankCard({ avatar: Buffer.from("not an image"), name: "A", level: 3, rank: 1, current: 10, needed: 205, xp: 500 });
  assert.equal((await sharp(rank).metadata()).format, "jpeg", "a broken photo falls back to the initial");
  assert.equal(cards.esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
});

test("the welcome message uses the local card (no third-party image API)", async () => {
  const t = realBot();
  groupData(t.app.state).update((d) => (d.welcome[GROUP] = { enabled: true }));
  await t.dispatcher.handleEvent("group-participants.update", t.sock, { id: GROUP, participants: [USER], action: "add" });
  const msg = t.sock.sent.at(-1).content;
  assert.ok(Buffer.isBuffer(msg.image));
  assert.match(msg.caption, /Welcome @447911123456/);
});

// ---- antilink allow-list --------------------------------------------------------------------

test("antilink lets allowed domains through and still removes other links", async () => {
  const t = realBot();
  groupData(t.app.state).update((d) => (d.antilink[GROUP] = { enabled: true, action: "delete" }));
  await t.send({ text: ".linkallow youtube.com", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /youtube\.com are allowed/);
  const before = t.sock.sent.length;
  await t.send({ text: "watch https://www.youtube.com/watch?v=1", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.filter((s) => s.content.delete).length, 0);
  await t.send({ text: "https://youtube.com.evil.example/x", chat: GROUP, sender: USER });
  assert.ok(t.sock.sent.slice(before).some((s) => s.content.delete), "look-alike domain is removed");
});

// ---- limits -----------------------------------------------------------------------------------

test("heavy jobs run at most N at a time and queue the rest", async () => {
  jobs.setLimit(2);
  let running = 0;
  let peak = 0;
  const job = () =>
    jobs.heavy(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    });
  await Promise.all(Array.from({ length: 7 }, job));
  assert.equal(peak, 2);
  assert.deepEqual(jobs.status(), { running: 0, queued: 0, max: 2 });
});

test("one person can't run more than COMMANDS_PER_MINUTE commands; the owner can", async () => {
  const t = realBot({ env: { COMMANDS_PER_MINUTE: "3" } });
  for (let i = 0; i < 3; i++) await t.send({ text: ".flip", chat: USER });
  await t.send({ text: ".flip", chat: USER });
  assert.match(t.last(), /too fast/);
  const count = t.sock.sent.length;
  await t.send({ text: ".flip", chat: USER });
  assert.equal(t.sock.sent.length, count, "the warning is not repeated");
  for (let i = 0; i < 5; i++) await t.send({ text: ".flip", chat: `${OWNER}@s.whatsapp.net` });
  assert.match(t.last(), /Heads|Tails/);
});

test("after .update or .restart the bot reports back once it is connected", async () => {
  const t = realBot();
  notices.setPending(t.app.state, { chat: `${OWNER}@s.whatsapp.net`, kind: "update", fromVersion: "2.5.0" });
  t.app.health.state = "close";
  assert.equal(await notices.deliverPending(t.app, "2.6.0"), false);
  t.app.health.state = "open";
  assert.equal(await notices.deliverPending(t.app, "2.6.0"), true);
  assert.match(t.last(), /now running v2\.6\.0 \(was v2\.5\.0\)/);
  assert.equal(await notices.deliverPending(t.app, "2.6.0"), false, "only once");
});
