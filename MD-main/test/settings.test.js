"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR, createApp } = require("../src/main");
const { buildConfig, ConfigError } = require("../src/config");
const vars = require("../src/services/vars");
const cookies = require("../src/services/cookies");
const { scrub } = require("../src/services/ai");
const { isSecretCommand } = require("../src/services/secrets");
const units = require("../src/services/units");
const { vttToText } = require("../src/services/ytdlp");
const { htmlToText } = require("../src/services/webtext");
const { track } = require("../src/listeners/antispam");
const utils = require("../src/commands/tools/utils");
const { makeApp, makeSock, makeMsg, tmpDir, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;

function realBot(env = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({ env, commands: loaded, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

// ---- settings from chat ---------------------------------------------------------

test(".setvar applies a setting immediately, saves it, and .delvar restores .env", async () => {
  const t = realBot({ BOT_NAME: "From Env" });
  await t.send({ text: ".setvar BOT_NAME Chat Name", chat: OWNER_JID });
  assert.match(t.last(), /BOT_NAME = Chat Name/);
  assert.equal(t.app.config.bot.name, "Chat Name");
  const file = path.join(t.app.config.paths.data, vars.FILE);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { BOT_NAME: "Chat Name" });

  await t.send({ text: ".delvar BOT_NAME", chat: OWNER_JID });
  assert.equal(t.app.config.bot.name, "From Env");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {});
});

test(".setvar rejects invalid values and settings that must stay in .env", async () => {
  const t = realBot();
  await t.send({ text: ".setvar PREFIX !!!!", chat: OWNER_JID });
  assert.match(t.last(), /Not saved:[\s\S]*PREFIX must be 1-3/);
  assert.equal(t.app.config.bot.prefix, ".");
  for (const key of ["OWNER_NUMBERS", "SESSION_DIR", "DATA_DIR", "UPDATE_REMOTE", "HEALTH_HOST", "PAIRING_NUMBER"]) {
    await t.send({ text: `.setvar ${key} x`, chat: OWNER_JID });
    assert.match(t.last(), /not a setting that can be changed from chat/, key);
  }
});

test(".setvar is owner-only, and secrets are refused in groups", async () => {
  const t = realBot();
  await t.send({ text: ".setvar BOT_NAME Hacked", chat: USER });
  assert.match(t.last(), /only for the bot owner/);
  await t.send({ text: ".setvar GEMINI_API_KEY AIzaSecretSecret", chat: GROUP, sender: OWNER_JID });
  assert.match(t.last(), /Never send keys in a group/);
  assert.equal(t.app.config.ai.keys.gemini, "");
});

test("a new prefix works at once; secrets are never displayed", async () => {
  const t = realBot();
  await t.send({ text: ".setvar PREFIX !", chat: OWNER_JID });
  await t.send({ text: "!setvar NEWSAPI_KEY abcdef1234567890", chat: OWNER_JID });
  assert.match(t.last(), /NEWSAPI_KEY = ••••• \(16 chars\)/);
  await t.send({ text: "!vars keys", chat: OWNER_JID });
  assert.doesNotMatch(t.last(), /abcdef1234567890/);
  assert.match(t.last(), /NEWSAPI_KEY: •••••/);
});

test("chat settings override .env at startup; invalid ones are ignored instead of blocking startup", async () => {
  const dir = tmpDir();
  const env = { OWNER_NUMBERS: OWNER, DATA_DIR: path.join(dir, "data"), SESSION_DIR: path.join(dir, "s"), TMP_DIR: path.join(dir, "t"), LOG_LEVEL: "silent", BOT_NAME: "Env" };
  vars.save(env.DATA_DIR, { BOT_NAME: "Chat", NOT_ALLOWED: "x" });
  let app = await createApp({ env, capabilities: ALL_OFF });
  assert.equal(app.config.bot.name, "Chat");
  assert.equal(app.overrides.NOT_ALLOWED, undefined, "unknown keys are dropped");

  vars.save(env.DATA_DIR, { PREFIX: "toolong" });
  app = await createApp({ env, capabilities: ALL_OFF });
  assert.equal(app.config.bot.prefix, ".");
  assert.equal(app.config.bot.name, "Env");
});

// ---- AI providers ------------------------------------------------------------------

test("AI provider: auto picks the first provider with a key; models default per provider", () => {
  const base = { OWNER_NUMBERS: OWNER };
  assert.equal(buildConfig(base).ai.apiKey, "");
  const g = buildConfig({ ...base, GEMINI_API_KEY: "g" });
  assert.equal(g.ai.provider, "gemini");
  assert.equal(g.ai.model, "gemini-3.8-flash");
  assert.equal(buildConfig({ ...base, GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }).ai.provider, "claude");
  const forced = buildConfig({ ...base, GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "gemini", GEMINI_MODEL: "gemini-3.5-flash-lite" });
  assert.equal(forced.ai.provider, "gemini");
  assert.equal(forced.ai.model, "gemini-3.5-flash-lite");
  assert.equal(buildConfig({ ...base, ANTHROPIC_API_KEY: "a", AI_MODEL: "claude-old" }).ai.model, "claude-old", "AI_MODEL still works for Claude");
  assert.throws(() => buildConfig({ ...base, OPENAI_BASE_URL: "http://localhost:11434/v1" }), ConfigError);
  assert.throws(() => buildConfig({ ...base, AI_PROVIDER: "skynet" }), ConfigError);
});

test("provider error text is scrubbed of keys before logging", () => {
  assert.equal(scrub("Incorrect API key provided: sk-proj-abcd1234efgh"), "Incorrect API key provided: [key]");
  assert.equal(scrub("key AIzaSyA1234567890 invalid"), "key [key] invalid");
});

test("messages carrying secrets are recognised (antidelete never stores them)", () => {
  const t = realBot();
  assert.equal(isSecretCommand(t.app, ".setvar GEMINI_API_KEY x"), true);
  assert.equal(isSecretCommand(t.app, ".set GEMINI_API_KEY x"), true, "aliases count");
  assert.equal(isSecretCommand(t.app, ".setcookie youtube"), true);
  assert.equal(isSecretCommand(t.app, ".ping"), false);
});

// ---- cookies -----------------------------------------------------------------------

const T = "\t";
const NETSCAPE = [
  "# Netscape HTTP Cookie File",
  [".youtube.com", "TRUE", "/", "TRUE", "1900000000", "LOGIN_INFO", "abc"].join(T),
  ["#HttpOnly_.youtube.com", "TRUE", "/", "TRUE", "1900000000", "__Secure-3PSID", "xyz"].join(T),
  [".google.com", "TRUE", "/", "TRUE", "1900000000", "SID", "g"].join(T),
  [".mybank.example", "TRUE", "/", "TRUE", "1900000000", "session", "SECRET"].join(T),
].join("\n");

test("cookies: only the chosen site's cookies are kept, in every input format", () => {
  const r = cookies.parse(NETSCAPE, "youtube");
  assert.equal(r.cookies.length, 3);
  assert.equal(r.dropped, 1);
  assert.doesNotMatch(cookies.toNetscape(r.cookies), /mybank|SECRET/);
  assert.equal(cookies.summarize(r.cookies, "youtube").loggedIn, true);

  const json = JSON.stringify([{ domain: ".instagram.com", name: "sessionid", value: "s", hostOnly: false, expirationDate: 1900000000 }, { domain: "evil.example", name: "x", value: "y" }]);
  assert.equal(cookies.parse(json, "instagram").cookies.length, 1);
  assert.deepEqual(cookies.parse("auth_token=a; ct0=b", "twitter").cookies.map((c) => c.domain), [".twitter.com", ".twitter.com"]);
  assert.equal(cookies.parse(NETSCAPE.replace(/\t/g, "  "), "youtube").cookies.length, 3, "tabs turned into spaces by WhatsApp");
  assert.throws(() => cookies.parse("just some words", "youtube"), /couldn't read/);
  assert.throws(() => cookies.save(makeApp().config, "youtube", []), /No cookies/);
});

test("cookies: yt-dlp gets the site's own file, else YTDLP_COOKIES, else none", () => {
  const app = makeApp({ env: { YTDLP_COOKIES: "/srv/all-cookies.txt" } });
  assert.deepEqual(cookies.ytdlpArgs(app.config, "youtube"), ["--cookies", path.resolve("/srv/all-cookies.txt")]);
  cookies.save(app.config, "youtube", cookies.parse(NETSCAPE, "youtube").cookies);
  const file = cookies.fileFor(app.config, "youtube");
  assert.deepEqual(cookies.ytdlpArgs(app.config, "youtube"), ["--cookies", file]);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(cookies.ytdlpArgs(makeApp().config, "tiktok"), []);
  assert.deepEqual(cookies.ytdlpArgs(app.config, "../../etc/passwd"), ["--cookies", path.resolve("/srv/all-cookies.txt")]);
});

test(".setcookie only works in a private chat with the owner", async () => {
  const t = realBot();
  await t.send({ text: ".setcookie youtube SID=a; HSID=b", chat: GROUP, sender: OWNER_JID });
  assert.match(t.last(), /only works in a private chat/);
  await t.send({ text: ".setcookie youtube SID=a; HSID=b", chat: USER });
  assert.match(t.last(), /only for the bot owner/);
  await t.send({ text: ".setcookie youtube SID=a; LOGIN_INFO=b", chat: OWNER_JID });
  assert.match(t.last(), /Saved 2 youtube cookie/);
  assert.deepEqual(cookies.savedSites(t.app.config), ["youtube"]);
});

// ---- notes, antispam, utilities ------------------------------------------------------

test("notes: admins save in groups, anyone reads with #name", async () => {
  const t = realBot();
  await t.send({ text: ".save rules Be kind", chat: GROUP, sender: USER });
  assert.match(t.last(), /Only group admins/);
  await t.send({ text: ".save rules Be kind", chat: OWNER_JID });
  await t.send({ text: "#rules", chat: OWNER_JID });
  assert.equal(t.last(), "Be kind");
  await t.send({ text: "#RULES", chat: OWNER_JID });
  assert.equal(t.last(), "Be kind", "names are case-insensitive");
});

test("antispam counts messages in a sliding window", () => {
  const rule = { max: 3, seconds: 10 };
  const key = `g|u${Math.random()}`;
  const t0 = 1_000_000;
  assert.equal(track(key, rule, t0).over, false);
  track(key, rule, t0 + 1000);
  track(key, rule, t0 + 2000);
  assert.equal(track(key, rule, t0 + 3000).over, true, "4th message within 10 s");
  assert.equal(track(key, rule, t0 + 20000).over, false, "window moved on");
});

test("unit conversion", () => {
  assert.equal(Number(units.convert(10, "km", "mi").value.toFixed(4)), 6.2137);
  assert.equal(Number(units.convert(212, "°F", "celsius").value.toFixed(6)), 100);
  assert.equal(Number(units.convert(1, "feddan", "m2").value.toFixed(2)), 4200.83);
  assert.equal(units.convert(1, "gib", "mib").value, 1024);
  assert.throws(() => units.convert(1, "kg", "km"), /Can't convert/);
  assert.deepEqual(units.parse("10 km to mi"), { value: 10, from: "km", to: "mi" });
});

test("age, password and date parsing", () => {
  assert.equal(utils.parseDate("31/02/2000"), null);
  assert.deepEqual(utils.diffYmd(utils.parseDate("2000-05-14"), utils.parseDate("2026-10-06")), { y: 26, m: 4, d: 22 });
  const p = utils.password(20);
  assert.equal(p.length, 20);
  assert.match(p, /[A-Z]/);
  assert.match(p, /[a-z]/);
  assert.match(p, /\d/);
});

test("subtitles and web pages are reduced to plain text", () => {
  const vtt = "WEBVTT\nKind: captions\n\n00:00:01.000 --> 00:00:02.000\nhello <c>world</c>\n\n00:00:02.000 --> 00:00:03.000\nhello world\n\n00:00:03.000 --> 00:00:04.000\nnext &amp; last";
  assert.equal(vttToText(vtt), "hello world next & last");
  const page = htmlToText("<html><head><title>T &amp; U</title><script>evil()</script></head><body><nav>menu</nav><p>Hello&nbsp;there &#8212; friend</p></body></html>");
  assert.equal(page.title, "T & U");
  assert.equal(page.text, "Hello there — friend");
});

test(".setvar YTDLP_PATH only accepts a program that really is yt-dlp", async () => {
  const t = realBot();
  await t.send({ text: ".setvar YTDLP_PATH node", chat: OWNER_JID });
  assert.match(t.last(), /runs, but it is not yt-dlp/);
  await t.send({ text: ".setvar YTDLP_PATH ~/surely-missing/yt-dlp", chat: OWNER_JID });
  assert.match(t.last(), /does not exist/);
  assert.equal(t.app.overrides.YTDLP_PATH, undefined);
});
