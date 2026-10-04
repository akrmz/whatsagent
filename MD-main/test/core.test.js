"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildConfig, ConfigError } = require("../src/config");
const { assertSafeUrl, isBlockedAddress, safeLookup, multipart } = require("../src/core/http");
const { createState } = require("../src/core/state");
const { LRU } = require("../src/core/lru");
const { parseCommand } = require("../src/core/context");
const { containsBadWord, LINK_RE } = require("../src/listeners/moderation");
const { formatUptime } = require("../src/commands/general/ping");
const { matchSiteUrl } = require("../src/services/ytdlp");
const { tmpDir, silentLog } = require("./helpers");

// ---- config -------------------------------------------------------------------

test("config: OWNER_NUMBERS is required and must include a country code", () => {
  assert.throws(() => buildConfig({}), ConfigError);
  assert.throws(() => buildConfig({ OWNER_NUMBERS: "01012345678" }), /starts with 0/);
  assert.throws(() => buildConfig({ OWNER_NUMBERS: "12345" }), /7 to 15 digits/);
  const c = buildConfig({ OWNER_NUMBERS: "+20 101 234 5678, 447911123456" });
  assert.deepEqual([...c.owners.numbers], ["201012345678", "447911123456"]);
  assert.equal(c.bot.prefix, ".");
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.limits));
});

test("config: reports every problem at once", () => {
  try {
    buildConfig({ OWNER_NUMBERS: "201012345678", PREFIX: "too long", MODE: "open", MAX_MEDIA_MB: "0", HEALTH_PORT: "x" });
    assert.fail("should throw");
  } catch (err) {
    assert.equal(err.problems.length, 4);
  }
});

// ---- SSRF protection ------------------------------------------------------------

test("http: blocks non-https, credentials, internal hosts and private IPs", () => {
  const blocked = [
    "http://example.com",
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://localhost/",
    "https://foo.internal/",
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://169.254.169.254/latest/meta-data/",
    "https://192.168.1.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://0.0.0.0/",
    "not a url",
  ];
  for (const url of blocked) assert.throws(() => assertSafeUrl(url), undefined, url);
  assert.equal(assertSafeUrl("https://example.com/a?b=c").hostname, "example.com");
  assert.equal(assertSafeUrl("http://example.com", { allowHttp: true }).protocol, "http:");
});

test("http: address classification", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.5.4", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("http: DNS results pointing at private addresses are refused at connect time", async () => {
  await new Promise((resolve) => {
    safeLookup("localhost", { all: true }, (err) => {
      assert.ok(err, "localhost must be refused");
      resolve();
    });
  });
});

test("http: multipart body", () => {
  const { body, contentType } = multipart([{ name: "a", value: "1" }, { name: "f", value: Buffer.from("x"), filename: "x.txt", contentType: "text/plain" }]);
  const boundary = contentType.split("boundary=")[1];
  assert.ok(body.toString().includes(`--${boundary}--`));
  assert.ok(body.toString().includes('filename="x.txt"'));
});

// ---- state ---------------------------------------------------------------------

test("state: atomic save and reload", () => {
  const dir = tmpDir();
  const s1 = createState({ dataDir: dir, log: silentLog });
  s1.store("banned", []).update((l) => l.push("1@s.whatsapp.net"));
  s1.flush();
  const s2 = createState({ dataDir: dir, log: silentLog });
  assert.deepEqual(s2.store("banned", []).data, ["1@s.whatsapp.net"]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
});

test("state: corrupt mode file fails CLOSED (private) and is moved aside", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "mode.json"), "{not json");
  const s = createState({ dataDir: dir, defaultMode: "public", log: silentLog });
  assert.equal(s.isPublic(), false);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("mode.json.corrupt-")));
});

test("state: migrates the old messageCount.json and merges warning counters", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "messageCount.json"), JSON.stringify({ isPublic: false, messageCount: {}, "g@g.us": { "u@s.whatsapp.net": 4 } }));
  fs.writeFileSync(path.join(dir, "warnings.json"), JSON.stringify({ "g@g.us": { "u@s.whatsapp.net": 1 } }));
  fs.writeFileSync(path.join(dir, "userGroupData.json"), JSON.stringify({ warnings: { "g@g.us": { "u@s.whatsapp.net": 1 } }, sudo: ["x"] }));
  const s = createState({ dataDir: dir, log: silentLog });
  assert.equal(s.isPublic(), false);
  assert.equal(s.store("messageCounts", {}).data["g@g.us"]["u@s.whatsapp.net"], 4);
  assert.equal(s.store("warnings", {}).data["g@g.us"]["u@s.whatsapp.net"], 2);
  assert.deepEqual(s.store("userGroupData", {}).data.sudo, ["x"]);
  assert.ok(fs.existsSync(path.join(dir, "messageCount.json.migrated")));
});

// ---- small helpers --------------------------------------------------------------

test("LRU evicts oldest and honours TTL", async () => {
  const evicted = [];
  const lru = new LRU({ max: 2, onEvict: (k) => evicted.push(k) });
  lru.set("a", 1).set("b", 2);
  lru.get("a");
  lru.set("c", 3);
  assert.deepEqual(evicted, ["b"]);
  lru.set("t", 1, 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(lru.get("t"), undefined);
});

test("parseCommand", () => {
  assert.deepEqual(parseCommand(".Ping", "."), { name: "ping", text: "", args: [] });
  assert.deepEqual(parseCommand("!tag Hello  World", "!"), { name: "tag", text: "Hello  World", args: ["Hello", "World"] });
  assert.equal(parseCommand("hello", "."), null);
  assert.equal(parseCommand(".", "."), null);
});

test("moderation matchers", () => {
  assert.equal(containsBadWord("you are an IDIOT!"), true);
  assert.equal(containsBadWord("classic shell hello"), false, "no substring matches");
  assert.equal(LINK_RE.test("see https://x.com/a"), true);
  assert.equal(LINK_RE.test("no links here"), false);
});

test("yt-dlp URL matching only accepts the expected site", () => {
  assert.ok(matchSiteUrl(".tt https://vm.tiktok.com/abc/", "tiktok"));
  assert.equal(matchSiteUrl("https://tiktok.com.evil.example/x", "tiktok"), null);
  assert.equal(matchSiteUrl("https://evil.example/?u=youtube.com", "youtube"), null);
  assert.equal(matchSiteUrl("file:///etc/passwd", "youtube"), null);
  assert.ok(matchSiteUrl("watch https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"));
});

test("ping formats uptime", () => {
  assert.equal(formatUptime(0), "0s");
  assert.equal(formatUptime(3725), "1h 2m 5s");
});
