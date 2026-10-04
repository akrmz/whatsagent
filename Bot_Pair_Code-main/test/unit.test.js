import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildConfig, ConfigError } from "../src/config.js";
import { normalizePhoneNumber } from "../src/phone.js";
import { createRateLimiter } from "../src/rateLimit.js";
import { deliverLocal } from "../src/delivery.js";
import { maskNumber } from "../src/logger.js";

const TOKEN = "x".repeat(32);

test("config: refuses to start without an access token", () => {
  assert.throws(() => buildConfig({}), ConfigError);
  assert.throws(() => buildConfig({ PAIR_ACCESS_TOKEN: "short" }), /at least 16/);
});

test("config: defaults are safe", () => {
  const c = buildConfig({ PAIR_ACCESS_TOKEN: TOKEN });
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.delivery, "local");
  assert.equal(c.overwriteSession, false);
  assert.equal(c.trustProxy, false);
});

test("config: reports every invalid value at once", () => {
  try {
    buildConfig({ PAIR_ACCESS_TOKEN: TOKEN, PORT: "99999", PAIR_DELIVERY: "pastebin", TRUST_PROXY: "maybe" });
    assert.fail("expected ConfigError");
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.problems.length, 3);
  }
});

test("phone: accepts international formats, rejects junk and traversal", () => {
  assert.equal(normalizePhoneNumber("+44 7911 123456"), "447911123456");
  assert.equal(normalizePhoneNumber("201012345678"), "201012345678");
  for (const bad of ["..", "../../etc", ".", "", "abc", "123", "+0000000", undefined, ["447911123456"], { a: 1 }]) {
    assert.equal(normalizePhoneNumber(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("rate limiter: blocks after max and resets after the window", () => {
  let now = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });
  assert.equal(rl.check("a").allowed, true);
  assert.equal(rl.check("a").allowed, true);
  assert.equal(rl.check("a").allowed, false);
  assert.equal(rl.check("b").allowed, true);
  now = 1001;
  assert.equal(rl.check("a").allowed, true);
  assert.equal(rl.size(), 1, "expired entries are pruned");
});

test("logger: masks phone numbers", () => {
  assert.equal(maskNumber("447911123456"), "********3456");
  assert.equal(maskNumber("12"), "****");
});

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pairtest-"));
}

test("delivery: writes into an empty session folder", () => {
  const root = tmpdir();
  const from = path.join(root, "from");
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, "creds.json"), JSON.stringify({ registered: true, me: { id: "1@s" } }));
  const out = path.join(root, "session");
  const r = deliverLocal(from, out);
  assert.equal(r.sidecar, false);
  assert.ok(fs.existsSync(path.join(out, "creds.json")));
});

test("delivery: never overwrites a working session unless asked", () => {
  const root = tmpdir();
  const from = path.join(root, "from");
  const out = path.join(root, "session");
  fs.mkdirSync(from);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(from, "creds.json"), '{"registered":true,"me":{"id":"new"}}');
  fs.writeFileSync(path.join(out, "creds.json"), '{"registered":true,"me":{"id":"old"}}');

  const kept = deliverLocal(from, out);
  assert.equal(kept.sidecar, true);
  assert.match(fs.readFileSync(path.join(out, "creds.json"), "utf8"), /old/);
  assert.match(fs.readFileSync(path.join(kept.path, "creds.json"), "utf8"), /new/);

  const replaced = deliverLocal(from, out, { overwrite: true });
  assert.equal(replaced.replaced, true);
  assert.match(fs.readFileSync(path.join(out, "creds.json"), "utf8"), /new/);
  assert.ok(fs.readdirSync(root).some((n) => n.startsWith("session.bak-")), "old session backed up");
});
