import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createPairingManager, BusyError } from "../src/pairing.js";
import { createLogger } from "../src/logger.js";

// A stand-in for a Baileys socket. Tests drive it by emitting connection.update events.
function fakeSockets() {
  const sockets = [];
  const factory = () => {
    const sock = {
      ev: new EventEmitter(),
      ended: false,
      user: { id: "447911123456:3@s.whatsapp.net" },
      end() {
        this.ended = true;
      },
      requestPairingCode: async () => "ABCD1234",
      sendMessage: async () => {},
    };
    sockets.push(sock);
    return sock;
  };
  return { sockets, factory };
}

function setup(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pairmgr-"));
  const config = {
    workDir: path.join(root, "work"),
    sessionOutputDir: path.join(root, "session"),
    delivery: "local",
    overwriteSession: false,
    maxConcurrent: 2,
    timeoutSeconds: 30,
    ...overrides,
  };
  const { sockets, factory } = fakeSockets();
  const manager = createPairingManager({
    config,
    logger: createLogger("silent"),
    socketFactory: factory,
    fetchVersion: async () => ({ version: [2, 3000, 1] }),
  });
  return { root, config, sockets, manager };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await tick();
  }
  throw new Error("condition not met in time");
}

test("code flow: returns a formatted code, saves the session, closes the socket, cleans up", async () => {
  const { config, sockets, manager } = setup();
  const pending = manager.start({ mode: "code", number: "447911123456" });
  await waitFor(() => sockets.length === 1);
  sockets[0].ev.emit("connection.update", { qr: "fake-qr" });
  const first = await pending;
  assert.equal(first.code, "ABCD-1234");
  assert.equal(manager.status(first.id).state, "waiting");

  // WhatsApp asks for a restart after pairing (515), then the connection opens.
  sockets[0].ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 515 } } },
  });
  await waitFor(() => sockets.length === 2);
  sockets[1].ev.emit("connection.update", { connection: "open" });

  await waitFor(() => manager.status(first.id).state === "delivered");
  assert.ok(fs.existsSync(path.join(config.sessionOutputDir, "creds.json")), "session saved for the bot");
  assert.equal(sockets[1].ended, true, "socket closed after delivery");
  assert.deepEqual(fs.readdirSync(config.workDir), [], "temporary folder removed");
  assert.equal(manager.activeCount(), 0);
});

test("failure before a code is issued rejects and frees the slot", async () => {
  const { config, sockets, manager } = setup();
  const pending = manager.start({ mode: "code", number: "447911123456" });
  await waitFor(() => sockets.length === 1);
  sockets[0].ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 403 } } },
  });
  await assert.rejects(pending, /403/);
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(fs.readdirSync(config.workDir), []);
});

test("concurrency cap and one pairing per number", async () => {
  const { sockets, manager } = setup({ maxConcurrent: 2 });
  const a = manager.start({ mode: "code", number: "447911123456" });
  await assert.rejects(manager.start({ mode: "code", number: "447911123456" }), BusyError);
  const b = manager.start({ mode: "qr" });
  await assert.rejects(manager.start({ mode: "qr" }), BusyError);

  await waitFor(() => sockets.length === 2);
  for (const s of sockets) {
    s.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  }
  await Promise.allSettled([a, b]);
  assert.equal(manager.activeCount(), 0);
});

test("timeout ends the socket and removes the folder", async () => {
  const { config, sockets, manager } = setup({ timeoutSeconds: 0.2 });
  const pending = manager.start({ mode: "qr" });
  await waitFor(() => sockets.length === 1);
  sockets[0].ev.emit("connection.update", { qr: "fake-qr" });
  const { id, qr } = await pending;
  assert.match(qr, /^data:image\/png;base64,/);
  await waitFor(() => manager.status(id).state === "expired");
  assert.equal(sockets[0].ended, true);
  assert.deepEqual(fs.readdirSync(config.workDir), []);
  assert.equal(manager.activeCount(), 0);
});
