"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadCommands, loadListeners, LoaderError } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { tmpDir } = require("./helpers");

const ALL = new Proxy({}, { get: () => true, has: () => true });

function writeCommands(files) {
  const dir = tmpDir("cmds-");
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), source);
  }
  return dir;
}

test("every real command and listener loads with valid metadata and unique names", () => {
  const { list, byName } = loadCommands(COMMANDS_DIR, { capabilities: ALL });
  assert.ok(list.length > 100, `expected >100 commands, got ${list.length}`);
  assert.ok(byName.has("help") && byName.has("menu") && byName.has("ping"));
  assert.ok(!byName.has("example"), "_template.js must not be loaded");
  for (const c of list) assert.ok(c.description.length > 5, `${c.name} needs a description`);
  const { byEvent } = loadListeners(LISTENERS_DIR, { capabilities: ALL });
  assert.ok(byEvent.get("message:pre").length >= 4);
});

test("a command is discovered just by adding a file (also in a new folder)", () => {
  const dir = writeCommands({
    "fun/coin.js": `module.exports = { name: "coin", category: "fun", description: "Flips a coin.", run: async () => {} };`,
    "brandnew/hello.js": `module.exports = [{ name: "hello", aliases: ["hi"], category: "brandnew", description: "Says hi.", run: async () => {} }];`,
    "_ignored.js": `module.exports = { broken: true };`,
  });
  const { list, byName } = loadCommands(dir, { capabilities: {} });
  assert.deepEqual(list.map((c) => c.name).sort(), ["coin", "hello"]);
  assert.equal(byName.get("hi").name, "hello");
  assert.equal(byName.get("coin").permission, "user", "defaults applied");
});

test("invalid metadata stops startup with a clear message", () => {
  const cases = {
    "a.js": `module.exports = { name: "Bad Name", category: "x", description: "d", run(){} };`,
    "b.js": `module.exports = { name: "b", category: "x", description: "d", permission: "admin", run(){} };`,
    "c.js": `module.exports = { name: "c", category: "x", description: "d", groupOnly: true, privateOnly: true, run(){} };`,
    "d.js": `module.exports = { name: "d", category: "x", description: "d" };`,
    "e.js": `module.exports = { name: "e", category: "x", description: "d", requires: ["nope"], run(){} };`,
  };
  for (const [file, src] of Object.entries(cases)) {
    const dir = writeCommands({ [file]: src });
    assert.throws(() => loadCommands(dir, { capabilities: { ffmpeg: true } }), LoaderError, file);
  }
});

test("duplicate names or aliases are rejected", () => {
  const dir = writeCommands({
    "one.js": `module.exports = { name: "one", aliases: ["x"], category: "c", description: "d", run(){} };`,
    "two.js": `module.exports = { name: "two", aliases: ["x"], category: "c", description: "d", run(){} };`,
  });
  assert.throws(() => loadCommands(dir), /already used/);
});

test("commands with a missing requirement are disabled, not loaded", () => {
  const dir = writeCommands({
    "w.js": `module.exports = { name: "w", category: "c", description: "d", requires: ["openWeather"], run(){} };`,
  });
  const off = loadCommands(dir, { capabilities: { openWeather: false } });
  assert.equal(off.byName.has("w"), false);
  assert.deepEqual(off.disabled, [{ name: "w", missing: ["openWeather"] }]);
  const on = loadCommands(dir, { capabilities: { openWeather: true } });
  assert.equal(on.byName.has("w"), true);
});

test("listener validation", () => {
  const dir = writeCommands({ "l.js": `module.exports = { name: "l", event: "message", run(){} };` });
  assert.throws(() => loadListeners(dir), /phase/);
});
