"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildConfig, ConfigError } = require("../src/config");
const { evaluate, formatNumber } = require("../src/services/calc");
const reminders = require("../src/services/reminders");
const help = require("../src/services/help");
const ytdlp = require("../src/services/ytdlp");
const geo = require("../src/services/geo");
const { makeApp, makeSock, makeMsg, OWNER } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const OTHER = "447911654321@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";

// Every optional capability off: what a fresh install without tools or keys looks like.
const CAPS = Object.fromEntries(
  ["ffmpeg", "ytdlp", "ai", "aiImage", "aiAudio", "font", "newsApi", "openWeather", "tenor", "telegramBot", "removeBg", "remini", "githubRepo"].map((k) => [k, false]),
);

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: CAPS });
  // Loaded commands are frozen; use copies without cooldowns, since tests send commands back to back.
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = {
    list: [...copies.values()],
    byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])),
    disabled: loaded.disabled,
  };
  const listeners = loadListeners(LISTENERS_DIR, { capabilities: CAPS });
  const app = makeApp({ commands, listeners });
  app.capabilities = CAPS;
  const sock = makeSock();
  app.sock = sock;
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const texts = () => sock.sent.map((s) => s.content?.text).filter(Boolean);
  return { app, sock, dispatcher, send, texts };
}

/** A group message that @mentions someone. */
function mentionMsg({ text, sender, mentions }) {
  return {
    key: { id: `M${Math.random()}`, remoteJid: GROUP, fromMe: false, participant: sender },
    pushName: "Tester",
    message: { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } },
  };
}

// ---- calculator ---------------------------------------------------------------

test("calc evaluates arithmetic with the usual precedence", () => {
  const cases = {
    "2+3*4": 14,
    "2^3^2": 512,
    "-2^2": -4,
    "2^-1": 0.5,
    "(1+2)(3+4)": 21,
    "2pi": 2 * Math.PI,
    "5!": 120,
    "sqrt(16)+max(1,7,3)": 11,
    "10 ÷ 4": 2.5,
    "2 x 3": 6,
    "100 % 7": 2,
  };
  for (const [expr, want] of Object.entries(cases)) assert.equal(evaluate(expr), want, expr);
  assert.equal(formatNumber(evaluate("0.1+0.2")), "0.3");
  assert.equal(formatNumber(evaluate("sin(30)")), "0.5");
});

test("calc never runs code: names outside the whitelist are rejected", () => {
  for (const evil of ["process.exit()", "constructor", "__proto__", "toString()", "a=1", "1;2", "require('fs')", "`x`"]) {
    assert.throws(() => evaluate(evil), { name: "UserError" }, evil);
  }
  assert.throws(() => evaluate("(".repeat(200) + "1" + ")".repeat(200)), { name: "UserError" });
});

test(".calc replies with the result, including 'x% of y'", async () => {
  const t = realBot();
  await t.send({ text: ".calc 15% of 80", chat: USER });
  await t.send({ text: ".calc 2+", chat: USER });
  assert.match(t.texts()[0], /= \*12\*/);
  assert.match(t.texts()[1], /^❌/);
});

// ---- reminders ----------------------------------------------------------------

test("reminder durations are parsed from the start of the text", () => {
  assert.deepEqual(reminders.parseDuration("1h30m call mom"), { ms: 90 * 60000, rest: "call mom" });
  assert.deepEqual(reminders.parseDuration("2 days pay rent"), { ms: 2 * 86400000, rest: "pay rent" });
  assert.deepEqual(reminders.parseDuration("10min"), { ms: 600000, rest: "" });
  assert.equal(reminders.parseDuration("hello 10m"), null);
  assert.equal(reminders.parseDuration("10 apples"), null);
  assert.equal(reminders.formatDuration(90061000), "1d 1h");
});

test(".remind stores a reminder and delivers it to the same chat when due", async () => {
  const t = realBot();
  await t.send({ text: ".remind 10m stretch your legs", chat: GROUP, sender: USER });
  assert.match(t.texts().at(-1), /Reminder #1 set/);
  await t.send({ text: ".remind list", chat: GROUP, sender: USER });
  assert.match(t.texts().at(-1), /stretch your legs/);

  assert.equal(await reminders.deliverDue(t.app, Date.now() + 5 * 60000), 0, "not due yet");
  assert.equal(await reminders.deliverDue(t.app, Date.now() + 11 * 60000), 1);
  const sent = t.sock.sent.at(-1);
  assert.equal(sent.jid, GROUP);
  assert.match(sent.content.text, /Reminder.*\n\nstretch your legs/s);
  assert.deepEqual(sent.content.mentions, [USER]);
  assert.equal(reminders.listFor(t.app.state, USER).length, 0, "delivered reminders are removed");
});

test("reminders: overdue ones are marked late; nothing is sent while disconnected", async () => {
  const t = realBot();
  reminders.add(t.app.state, { chat: USER, sender: USER, text: "x", ms: 60000 });
  t.app.health.state = "close";
  assert.equal(await reminders.deliverDue(t.app, Date.now() + 3600e3), 0);
  t.app.health.state = "open";
  assert.equal(await reminders.deliverDue(t.app, Date.now() + 3600e3), 1);
  assert.match(t.sock.sent.at(-1).content.text, /late by/);
});

test("reminders: limits per user, and users can only delete their own", async () => {
  const t = realBot();
  for (let i = 0; i < reminders.MAX_PER_USER; i++) reminders.add(t.app.state, { chat: USER, sender: USER, text: `r${i}`, ms: 60000 });
  assert.throws(() => reminders.add(t.app.state, { chat: USER, sender: USER, text: "one more", ms: 60000 }), /already have/);
  assert.throws(() => reminders.add(t.app.state, { chat: USER, sender: OTHER, text: "x", ms: 1000 }), /shortest/);
  assert.throws(() => reminders.add(t.app.state, { chat: USER, sender: OTHER, text: "x", ms: 61 * 86400000 }), /longest/);
  assert.equal(reminders.remove(t.app.state, OTHER, 1), false);
  assert.equal(reminders.remove(t.app.state, USER, 1), true);
});

// ---- afk -----------------------------------------------------------------------

test("afk: mentions get a notice once, and the user's next message clears it", async () => {
  const t = realBot();
  await t.send({ text: ".afk at lunch", chat: GROUP, sender: USER });
  assert.match(t.texts().at(-1), /You are now AFK: at lunch/);

  await t.dispatcher.handleMessage(t.sock, mentionMsg({ text: "@447911123456 you there?", sender: OTHER, mentions: [USER] }));
  assert.match(t.texts().at(-1), /is AFK .*\n📝 at lunch/s);
  const count = t.sock.sent.length;
  await t.dispatcher.handleMessage(t.sock, mentionMsg({ text: "@447911123456 hello??", sender: OTHER, mentions: [USER] }));
  assert.equal(t.sock.sent.length, count, "no repeated notice within 5 minutes");

  await t.send({ text: "I'm back", chat: GROUP, sender: USER });
  assert.match(t.texts().at(-1), /Welcome back/);
  const after = t.sock.sent.length;
  await t.send({ text: "still here", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.length, after, "welcome back is said only once");
});

// ---- help ----------------------------------------------------------------------

test("help: sections by name, and suggestions for typos", async () => {
  const t = realBot();
  const { list, byName } = t.app.commands;
  assert.equal(help.findCategory("game", list), "games");
  assert.equal(help.findCategory("Tools", list), "tools");
  assert.equal(help.findCategory("search", list), "info", "matches a word of the section title");
  assert.equal(help.findCategory("downloads", list), null, "all download commands are disabled without yt-dlp");
  assert.equal(help.findCategory("nonsense", list), null);
  assert.ok(help.suggest("calcc", byName).includes("calc"));
  assert.ok(help.suggest("remnd", byName).includes("remind"));

  await t.send({ text: ".help tools", chat: USER });
  assert.match(t.texts().at(-1), /Tools.*\.calc/s);
  await t.send({ text: ".help qrr", chat: USER });
  assert.match(t.texts().at(-1), /Did you mean: \.qr/);
});

test("commands that need missing tools are disabled and hidden from .help", () => {
  const t = realBot();
  const disabled = t.app.commands.disabled.map((d) => d.name);
  for (const name of ["toaudio", "tovn", "yts", "dl", "song"]) assert.ok(disabled.includes(name), name);
  assert.ok(t.app.commands.byName.get("calc"));
});

// ---- misc ------------------------------------------------------------------------

test(".poll sends a native poll; 'multi' allows several answers", async () => {
  const t = realBot();
  await t.send({ text: ".poll Lunch? | Pizza | Koshary | Pizza", chat: GROUP, sender: USER });
  assert.deepEqual(t.sock.sent.at(-1).content.poll, { name: "Lunch?", values: ["Pizza", "Koshary"], selectableCount: 1 });
  await t.send({ text: ".poll multi Days? | Mon | Tue", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.at(-1).content.poll.selectableCount, 0);
  await t.send({ text: ".poll only a question", chat: GROUP, sender: USER });
  assert.match(t.texts().at(-1), /Usage/);
});

test("currency arguments are parsed in several forms", () => {
  const { parse } = require("../src/commands/tools/currency");
  assert.deepEqual(parse("100 usd egp"), { amount: 100, from: "USD", to: "EGP" });
  assert.deepEqual(parse("50 EUR to usd"), { amount: 50, from: "EUR", to: "USD" });
  assert.deepEqual(parse("1,250.5 usd in sar"), { amount: 1250.5, from: "USD", to: "SAR" });
  assert.deepEqual(parse("usd jpy"), { amount: 1, from: "USD", to: "JPY" });
  assert.equal(parse("usd"), null);
  assert.equal(parse("../../etc egp usd"), null);
});

test(".dl accepts links only from the supported sites", () => {
  assert.deepEqual(ytdlp.detectSite("see https://x.com/user/status/1"), { site: "twitter", url: "https://x.com/user/status/1" });
  assert.equal(ytdlp.detectSite("https://soundcloud.com/a/b").site, "soundcloud");
  assert.equal(ytdlp.detectSite("https://evil.example/x.com"), null);
  assert.equal(ytdlp.detectSite("https://x.com.evil.example/"), null);
  assert.equal(ytdlp.detectSite("https://user:pw@x.com/"), null);
  assert.equal(ytdlp.detectSite("file:///etc/passwd"), null);
});

test("network failures inside commands are reported as an external-service problem", async () => {
  const t = realBot();
  const cmd = { name: "net", aliases: [], category: "t", description: "d", permission: "user", requires: [], cooldown: 0 };
  cmd.run = async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  };
  t.app.commands.byName.set("net", cmd);
  await t.send({ text: ".net", chat: USER });
  assert.match(t.texts().at(-1), /external service/);
});

test("TIMEZONE must be a real time zone", () => {
  assert.equal(buildConfig({ OWNER_NUMBERS: OWNER, TIMEZONE: "Africa/Cairo" }).bot.timezone, "Africa/Cairo");
  assert.throws(() => buildConfig({ OWNER_NUMBERS: OWNER, TIMEZONE: "Mars/Olympus" }), ConfigError);
  assert.equal(geo.utcOffset(new Date("2026-01-15T12:00:00Z"), "Asia/Tokyo"), "UTC+09:00");
});
