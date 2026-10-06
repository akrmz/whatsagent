"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildConfig } = require("../src/config");
const reminders = require("../src/services/reminders");
const aiusage = require("../src/services/aiusage");
const { parseRss, ago } = require("../src/services/news");
const { mediaProviders } = require("../src/services/ai");
const autoupdate = require("../src/services/autoupdate");
const groupcmds = require("../src/services/groupcmds");
const { toSticker } = require("../src/core/media");
const { makeApp, makeSock, makeMsg, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;

function realBot({ env = {}, participants = [] } = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  // Copies without cooldowns: tests send commands back to back.
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants });
  app.sock = sock;
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

// ---- reminders: times of day and repeats --------------------------------------------

test("reminders understand 'at 18:30', 'tomorrow at 9am' and 'every day at 08:00' in the bot's time zone", () => {
  const now = Date.parse("2026-10-06T10:00:30Z"); // 13:00:30 in Cairo (UTC+3)
  const min = (t) => reminders.parseWhen(t, "Africa/Cairo", now);
  assert.equal(min("at 18:30 call").ms, (5 * 60 + 29.5) * 60000);
  assert.equal(min("at 13:00 x").ms, (23 * 60 + 59.5) * 60000, "a time already passed today means tomorrow");
  assert.equal(min("tomorrow at 14:00 x").ms, (25 * 60 - 0.5) * 60000);
  assert.equal(min("18:30 bare").rest, "bare");
  assert.deepEqual(min("every day at 08:00 pills").every, 86400000);
  assert.equal(min("every 2h stretch").ms, 7200000);
  assert.equal(min("10 apples"), null, "a number alone is not a time");
  assert.equal(min("at 25:00 x"), null);
});

test("a repeating reminder is sent and rescheduled, and can be stopped", async () => {
  const t = realBot();
  t.app.health.state = "open";
  const item = reminders.add(t.app.state, { chat: GROUP, sender: USER, text: "water", ms: 60000, every: 3600000 });
  assert.throws(() => reminders.add(t.app.state, { chat: GROUP, sender: USER, text: "x", ms: 60000, every: 60000 }), /every 10 minutes/);
  const firstDue = item.due;
  assert.equal(await reminders.deliverDue(t.app, firstDue + 1000), 1);
  assert.match(t.sock.sent.at(-1).content.text, /🔁 every 1h/);
  const [again] = reminders.listFor(t.app.state, USER);
  assert.equal(again.due, firstDue + 3600000, "next one an hour later");
  // Offline for 5 hours: one late reminder, then back on schedule.
  assert.equal(await reminders.deliverDue(t.app, firstDue + 5 * 3600000 + 1000), 1);
  assert.equal(reminders.listFor(t.app.state, USER)[0].due, firstDue + 6 * 3600000);
  assert.equal(reminders.remove(t.app.state, USER, item.id), true);
});

// ---- per-group command switches, suggestions, stats ---------------------------------

test("group admins can turn commands off and on; owner is not affected; .help can't be disabled", async () => {
  const participants = [{ id: ADMIN, admin: "admin" }, { id: USER }, { id: "15550000009@s.whatsapp.net", admin: "admin" }];
  const t = realBot({ participants });
  await t.send({ text: ".disable calc help", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /Turned off here: \.calc[\s\S]*Can't turn off: \.help/);
  await t.send({ text: ".calc 1+1", chat: GROUP, sender: USER });
  assert.match(t.last(), /\.calc is turned off in this group/);
  const count = t.sock.sent.length;
  await t.send({ text: ".calc 2+2", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.length, count, "the notice is not repeated every time");
  await t.send({ text: ".calc 3+3", chat: GROUP, sender: OWNER_JID });
  assert.match(t.last(), /= \*6\*/, "the owner can still use it");
  await t.send({ text: ".calc 1+1", chat: USER });
  assert.match(t.last(), /= \*2\*/, "only that group is affected");
  await t.send({ text: ".enable all", chat: GROUP, sender: ADMIN });
  await t.send({ text: ".calc 4+4", chat: GROUP, sender: USER });
  assert.match(t.last(), /= \*8\*/);
  await t.send({ text: ".disable calc", chat: GROUP, sender: USER });
  assert.match(t.last(), /Only group admins/);
});

test("mistyped commands get one 'did you mean' per chat per minute; it can be turned off", async () => {
  const t = realBot();
  await t.send({ text: ".stickr", chat: USER });
  assert.match(t.last(), /There is no \.stickr\. Did you mean \.sticker/);
  const count = t.sock.sent.length;
  await t.send({ text: ".calcc 1", chat: USER });
  assert.equal(t.sock.sent.length, count, "rate limited");
  await t.send({ text: ".zzzzzz", chat: GROUP, sender: OWNER_JID });
  assert.equal(t.sock.sent.length, count, "nothing close: no reply");

  const quiet = realBot({ env: { SUGGEST_COMMANDS: "false" } });
  await quiet.send({ text: ".stickr", chat: USER });
  assert.equal(quiet.sock.sent.length, 0);
});

test("command usage is counted for .stats", async () => {
  const t = realBot();
  await t.send({ text: ".calc 1+1", chat: USER });
  await t.send({ text: ".calc 2+2", chat: USER });
  await t.send({ text: ".flip", chat: USER });
  const s = groupcmds.statsStore(t.app.state).data;
  assert.equal(s.commands.calc, 2);
  assert.equal(s.total, 3);
  await t.send({ text: ".stats", chat: OWNER_JID });
  assert.match(t.last(), /1\. \.calc — 2/);
});

// ---- AI limits and memory -------------------------------------------------------------

test("AI daily limit per person; owner and sudo are exempt", () => {
  const config = buildConfig({ OWNER_NUMBERS: OWNER, AI_DAILY_LIMIT: "3" });
  const user = { config, sender: `u${Math.random()}@s.whatsapp.net`, isSudoOrOwner: false };
  aiusage.takeQuota(user);
  aiusage.takeQuota(user, 2);
  assert.throws(() => aiusage.takeQuota(user), /today's AI limit \(3\)/);
  assert.equal(aiusage.remaining(user), 0);
  const owner = { ...user, isSudoOrOwner: true };
  for (let i = 0; i < 10; i++) aiusage.takeQuota(owner);
  const unlimited = { ...user, config: buildConfig({ OWNER_NUMBERS: OWNER, AI_DAILY_LIMIT: "0" }) };
  for (let i = 0; i < 10; i++) aiusage.takeQuota(unlimited);
});

test("AI memory keeps only the last N exchanges, and can be forgotten", () => {
  const key = `test|${Math.random()}`;
  for (let i = 1; i <= 5; i++) aiusage.remember(key, 2, `q${i}`, `a${i}`);
  assert.deepEqual(
    aiusage.history(key, 2).map((m) => m.content),
    ["q4", "a4", "q5", "a5"],
  );
  assert.deepEqual(aiusage.history(key, 0), []);
  aiusage.forget(key);
  assert.deepEqual(aiusage.history(key, 2), []);
});

test("pictures and transcription use Gemini or official OpenAI, never Claude", () => {
  const cfg = (env) => buildConfig({ OWNER_NUMBERS: OWNER, ...env });
  assert.deepEqual(mediaProviders(cfg({ ANTHROPIC_API_KEY: "a" })), []);
  assert.deepEqual(mediaProviders(cfg({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" })), ["gemini"]);
  assert.deepEqual(mediaProviders(cfg({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })), ["gemini", "openai"]);
  assert.deepEqual(mediaProviders(cfg({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o", AI_PROVIDER: "openai" })), ["openai", "gemini"]);
  assert.deepEqual(mediaProviders(cfg({ OPENAI_API_KEY: "o", OPENAI_BASE_URL: "https://api.groq.com/openai/v1" })), [], "compatible services differ");
  const t = realBot();
  const disabled = t.app.commands.disabled.map((d) => d.name);
  for (const n of ["imagine", "transcribe", "ai", "aireset", "summarize"]) assert.ok(disabled.includes(n), n);
});

// ---- news, auto-update, stickers ------------------------------------------------------------

test("Google News RSS is parsed and the source suffix removed", () => {
  const xml = `<rss><channel><item><title>Big news &amp; more - Example Times</title><link>https://news.google.com/x</link><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><source url="https://ex.example">Example Times</source></item><item><title><![CDATA[Second]]></title></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.deepEqual({ title: items[0].title, source: items[0].source }, { title: "Big news & more", source: "Example Times" });
  assert.equal(items[1].title, "Second");
  assert.equal(ago(Date.parse("2026-10-06T08:00:00Z"), Date.parse("2026-10-06T10:30:00Z")), "3h ago");
});

test("yt-dlp auto-update runs only when enabled, at most once a day, and records the result", async () => {
  const calls = [];
  const fake = () => ({
    ytdlpStatus: async () => (calls.push("status"), { installed: true, current: "2026.07.01", latest: "2026.10.05", behind: true }),
    updateYtdlp: async () => (calls.push("update"), "2026.10.05"),
  });
  const app = makeApp({ env: { YTDLP_AUTO_UPDATE: "true" }, capabilities: { ...ALL_OFF, ytdlp: true } });
  const now = Date.now();
  const r = await autoupdate.tick(app, now, fake);
  assert.match(r.message, /updated 2026\.07\.01 → 2026\.10\.05/);
  assert.equal(await autoupdate.tick(app, now + 3600e3, fake), null, "not again the same day");
  assert.deepEqual(calls, ["status", "update"]);
  const off = makeApp({ capabilities: { ...ALL_OFF, ytdlp: true } });
  assert.equal(await autoupdate.tick(off, now, fake), null);
});

test("picture stickers are made without ffmpeg", async () => {
  const sharp = require("sharp");
  const img = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#00aa55" } }).png().toBuffer();
  const sticker = await toSticker(img, { animated: false, ffmpegPath: "/definitely/not/ffmpeg", pack: "P" });
  const meta = await sharp(sticker).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});
