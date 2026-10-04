"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createUpdater, UpdateError } = require("../src/services/updater");
const { silentLog } = require("./helpers");

const OLD = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW = "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const config = { update: { remote: "origin", branch: "main" }, tools: { ytdlp: "yt-dlp" } };

/** Fake process runner. `responses` maps "cmd arg0 arg1" prefixes to results. */
function fakeRun(overrides = {}) {
  const calls = [];
  const defaults = {
    "git rev-parse --show-toplevel": { code: 0, stdout: "/srv/bot\n" },
    "git fetch": { code: 0, stdout: "" },
    "git rev-parse HEAD": { code: 0, stdout: `${OLD}\n` },
    "git rev-parse origin/main": { code: 0, stdout: `${NEW}\n` },
    "git rev-list": { code: 0, stdout: "0\t2\n" },
    "git status": { code: 0, stdout: "" },
    "git show": { code: 0, stdout: '{"version":"2.2.0"}' },
    "git log": { code: 0, stdout: "2222222 Add feature\n1234567 Fix bug\n" },
    "git merge": { code: 0, stdout: "" },
    "git diff": { code: 0, stdout: "MD-main/src/commands/fun/new.js\n" },
    "git reset": { code: 0, stdout: "" },
    "npm ci": { code: 0, stdout: "" },
    check: { code: 0, stdout: "✓ configuration valid" },
    "yt-dlp --version": { code: 0, stdout: "2026.09.01.000000\n" },
    "yt-dlp --update-to": { code: 0, stdout: "Updated yt-dlp to nightly@2026.09.27.232945" },
    ...overrides,
  };
  const run = async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    const key = args[0] === "src/check.js" ? "check" : Object.keys(defaults).filter((k) => line.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected command: ${line}`);
    const r = typeof defaults[key] === "function" ? defaults[key](line) : defaults[key];
    return { stderr: "", ...r };
  };
  return { run, calls };
}

const make = (overrides, fetchJson = async () => ({ tag_name: "2026.09.27.232945" })) => {
  const f = fakeRun(overrides);
  return { ...f, updater: createUpdater({ config, log: silentLog, run: f.run, fetchJson }) };
};

test("not a git clone (e.g. Docker): reported as unsupported, nothing else runs", async () => {
  const { updater, calls } = make({ "git rev-parse --show-toplevel": { code: 128, stdout: "", stderr: "not a git repository" } });
  const s = await updater.botStatus();
  assert.equal(s.supported, false);
  assert.match(s.reason, /not a git clone/);
  assert.equal(calls.length, 1);
});

test("status reports commits behind, versions and recent changes", async () => {
  const { updater } = make();
  const s = await updater.botStatus();
  assert.equal(s.behind, 2);
  assert.equal(s.ahead, 0);
  assert.equal(s.latestVersion, "2.2.0");
  assert.deepEqual(s.changes, ["2222222 Add feature", "1234567 Fix bug"]);
});

test("up to date", async () => {
  const { updater } = make({ "git rev-parse origin/main": { code: 0, stdout: OLD }, "git rev-list": { code: 0, stdout: "0\t0" } });
  assert.equal((await updater.botStatus()).behind, 0);
});

test("update fast-forwards and validates; no npm ci when dependencies did not change", async () => {
  const { updater, calls } = make();
  const result = await updater.updateBot(await updater.botStatus());
  assert.equal(result.to, NEW);
  assert.ok(calls.some((c) => c.startsWith("git merge --ff-only")));
  assert.ok(calls.some((c) => c.endsWith("src/check.js")));
  assert.ok(!calls.some((c) => c.startsWith("npm ci")));
  assert.ok(!calls.some((c) => c.startsWith("git reset")));
});

test("changed lockfile triggers npm ci", async () => {
  const { updater, calls } = make({ "git diff": { code: 0, stdout: "MD-main/package-lock.json\n" } });
  const result = await updater.updateBot(await updater.botStatus());
  assert.equal(result.depsChanged, true);
  assert.ok(calls.some((c) => c.startsWith("npm ci --omit=dev")));
});

test("failed validation rolls back to the previous commit", async () => {
  const { updater, calls } = make({ check: { code: 1, stdout: "", stderr: "Invalid command in fun/new.js" } });
  await assert.rejects(updater.updateBot(await updater.botStatus()), /rolled back.*Invalid command/);
  assert.ok(calls.includes(`git reset --hard --quiet ${OLD}`));
});

test("local changes or local-only commits block the update before anything changes", async () => {
  const dirty = make({ "git status": { code: 0, stdout: " M MD-main/src/main.js" } });
  await assert.rejects(dirty.updater.updateBot(await dirty.updater.botStatus()), UpdateError);
  assert.ok(!dirty.calls.some((c) => c.startsWith("git merge")));

  const ahead = make({ "git rev-list": { code: 0, stdout: "3\t1" } });
  await assert.rejects(ahead.updater.updateBot(await ahead.updater.botStatus()), /not on origin\/main/);
  assert.ok(!ahead.calls.some((c) => c.startsWith("git merge")));
});

test("only one update at a time", async () => {
  const { updater } = make();
  let release;
  const first = updater.exclusive(() => new Promise((r) => (release = r)));
  await assert.rejects(updater.exclusive(async () => {}), /already running/);
  release();
  await first;
});

test("yt-dlp: compares with the latest nightly and updates itself", async () => {
  const { updater, calls } = make();
  const s = await updater.ytdlpStatus();
  assert.deepEqual(s, { installed: true, current: "2026.09.01.000000", latest: "2026.09.27.232945", behind: true });
  await updater.updateYtdlp();
  assert.ok(calls.includes("yt-dlp --update-to nightly"));
});

test("yt-dlp installed with pip cannot self-update: clear message", async () => {
  const { updater } = make({ "yt-dlp --update-to": { code: 1, stdout: "", stderr: "You installed yt-dlp with pip or using the wheel from PyPi; Use that to update" } });
  await assert.rejects(updater.updateYtdlp(), /standalone nightly binary/);
});

test("config rejects option-like or odd remote/branch names", () => {
  const { buildConfig } = require("../src/config");
  assert.throws(() => buildConfig({ OWNER_NUMBERS: "201012345678", UPDATE_REMOTE: "--upload-pack=touch /tmp/x" }), /UPDATE_REMOTE/);
  assert.throws(() => buildConfig({ OWNER_NUMBERS: "201012345678", UPDATE_BRANCH: "main;rm -rf /" }), /UPDATE_BRANCH/);
});
