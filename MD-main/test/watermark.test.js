"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const media = require("../src/services/listingmedia");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  sock.onWhatsApp = async (jid) => [{ jid, exists: true }];
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, s: app.state, sock, send, lastImage: (jid) => sock.sent.filter((m) => m.jid === jid && m.content.image).at(-1)?.content.image };
}

async function withPhotos(b) {
  const p1 = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#88aacc" } }).jpeg().toBuffer();
  const p2 = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#ccaa88" } }).jpeg().toBuffer();
  const id = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME).id;
  re.addPhoto(b.s, b.app.config, id, p1);
  re.addPhoto(b.s, b.app.config, id, p2);
  return { id, p1, p2, dir: path.dirname(re.photoPath(b.app.config, id, 1)) };
}
const caches = (dir) => fs.readdirSync(dir).filter((f) => f.includes(".wm-"));

test("off by default: clients get the photo as it is; on: with your name and number, the original untouched", async (t) => {
  let now = Date.parse("2026-10-11T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const later = () => t.mock.timers.setTime((now += 60000)); // past the 30-second "same listing" rule
  const b = bot();
  const { p1, dir } = await withPhotos(b);
  await b.send("#1", CLIENT);
  assert.deepEqual(b.lastImage(CLIENT), p1, "off: as it is");

  await b.send(".agent name أحمد العقاري");
  await b.send(".agent phone +20 100 123 4567");
  await b.send(".agent watermark on");
  await b.send(".agent");
  assert.match(b.sock.sent.at(-1).content.text, /watermark: on \(photos clients get carry "أحمد العقاري · \+20 100 123 4567"\)/);
  later();
  await b.send("#1 en", CLIENT);
  const marked = b.lastImage(CLIENT);
  assert.notDeepEqual(marked, p1, "marked");
  assert.deepEqual((await sharp(marked).metadata()).width, 640, "same size");
  assert.deepEqual(fs.readFileSync(re.photoPath(b.app.config, 1, 1)), p1, "the original is untouched");
  assert.equal(caches(dir).length, 1, "the marked copy is kept beside it");
  assert.equal(re.photos(b.app.config, re.get(b.s, 1)).length, 2, "copies aren't counted as photos");

  // Sent to a client with .lead send: marked too, from the cache.
  leads.add(b.s, { name: "منى", phone: "201099998888" }, ME);
  await b.send(".lead send 1 1");
  assert.deepEqual(b.lastImage(CLIENT), marked);

  // New details: a new copy, the old one gone.
  await b.send(".agent phone +20 111 222 3333");
  later();
  await b.send("#1 en", CLIENT);
  assert.notDeepEqual(b.lastImage(CLIENT), marked);
  assert.equal(caches(dir).length, 1);

  await b.send(".agent wmtext مكتب أحمد للعقارات");
  await b.send(".agent");
  assert.match(b.sock.sent.at(-1).content.text, /carry "مكتب أحمد للعقارات"/);
});

test("reordering or deleting photos drops the marked copies; no name or number: no mark", async (t) => {
  let now = Date.parse("2026-10-11T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const later = () => t.mock.timers.setTime((now += 60000));
  const b = bot();
  const { p1, dir } = await withPhotos(b);
  await b.send(".agent watermark on");
  await b.send("#1", CLIENT);
  assert.deepEqual(b.lastImage(CLIENT), p1, "on, but nothing to write: as it is");
  await b.send(".agent name أحمد");
  later();
  await b.send("#1 en", CLIENT);
  assert.equal(caches(dir).length, 1);
  media.setCover(b.s, b.app.config, 1, 2);
  assert.equal(caches(dir).length, 0, "the new cover is marked afresh");
  await b.send(".agent watermark off");
  await b.send(".agent");
  assert.match(b.sock.sent.at(-1).content.text, /watermark: off/);
});
