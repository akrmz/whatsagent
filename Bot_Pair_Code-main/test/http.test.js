import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { createLogger } from "../src/logger.js";
import { BusyError } from "../src/pairing.js";

const TOKEN = "t".repeat(32);
let server;
let base;
const started = [];

const fakePairing = {
  start: async ({ mode, number }) => {
    started.push({ mode, number });
    if (number === "447911123457") throw new BusyError("busy");
    return mode === "code" ? { id: "job1", code: "ABCD-EFGH" } : { id: "job2", qr: "data:image/png;base64,AAA" };
  },
  status: (id) => (id === "job1" ? { id, state: "waiting" } : null),
  activeCount: () => 0,
};

before(async () => {
  const config = {
    accessToken: TOKEN,
    trustProxy: false,
    rateLimitWindowSeconds: 600,
    rateLimitMax: 6,
  };
  const app = createApp({ config, logger: createLogger("silent"), pairing: fakePairing });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body, token = TOKEN) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-access-token": token } : {}) },
    body: JSON.stringify(body),
  });

test("health endpoint works without a token", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "ok");
});

test("page is served with security headers", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("source files, package.json, mega.js and traversal are not reachable", async () => {
  for (const p of ["/index.js", "/package.json", "/mega.js", "/src/config.js", "/.env", "/%2e%2e/index.js", "/../package.json"]) {
    const res = await fetch(base + p);
    assert.notEqual(res.status, 200, `${p} must not be served`);
  }
});

test("API requires the access token", async () => {
  assert.equal((await post("/api/pair", { number: "+447911123456" }, null)).status, 401);
  assert.equal((await post("/api/pair", { number: "+447911123456" }, "wrong")).status, 401);
  assert.equal((await fetch(`${base}/api/status/job1`)).status, 401);
});

test("API validates the number before starting anything", async () => {
  const before = started.length;
  assert.equal((await post("/api/pair", { number: "../../etc" })).status, 400);
  assert.equal(started.length, before);
});

test("API returns a code, maps busy to 503, and rate limits", async () => {
  const ok = await post("/api/pair", { number: "+44 7911 123456" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: "job1", code: "ABCD-EFGH" });
  assert.equal(started.at(-1).number, "447911123456");

  assert.equal((await post("/api/pair", { number: "+447911123457" })).status, 503);

  // Limit is 6 per window: two 401s, one 400, one 200 and one 503 have been counted so far.
  let last;
  for (let i = 0; i < 5; i++) last = await post("/api/qr", {});
  assert.equal(last.status, 429);
  assert.ok(last.headers.get("retry-after"));
});
