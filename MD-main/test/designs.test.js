"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const img = require("../src/services/reimages");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `D${++n}`, remoteJid: from, fromMe: false }, pushName: "Agent", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: () => sock.sent.at(-1).content };
}

const photo = (r, g, b) => sharp({ create: { width: 800, height: 600, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
const size = async (buf) => {
  const m = await sharp(buf).metadata();
  return [m.format, m.width, m.height];
};

test("collage layout: 1 to 4 photos fill the top area without overlapping, the first on the right", () => {
  for (const n of [1, 2, 3, 4]) {
    const boxes = img.collageLayout(n);
    assert.equal(boxes.length, n);
    const area = boxes.reduce((a, b) => a + b.w * b.h, 0);
    assert.ok(area <= 1080 * 900 && area > 1080 * 900 * 0.98, `n=${n}: the photos fill the area (gaps aside)`);
    for (const [i, a] of boxes.entries()) {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1080 && a.y + a.h <= 900);
      for (const b of boxes.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `n=${n}: no overlap`);
    }
    if (n > 1) assert.ok(boxes[0].x > 0, "Arabic reads right to left: the first photo is on the right");
  }
});

test("story is 1080×1920 and collage 1080×1350, with or without photos and agent details", async () => {
  const l = { id: 3, type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, size: 150, rooms: 3, status: "available" };
  assert.deepEqual(await size(await img.story(l, { name: "أحمد", phone: "+20 100 123 4567" }, null)), ["jpeg", 1080, 1920]);
  assert.deepEqual(await size(await img.story({ ...l, status: "sold", price: undefined }, {}, null)), ["jpeg", 1080, 1920]);
  assert.deepEqual(await size(await img.collage(l, {}, [])), ["jpeg", 1080, 1350]);
});

test(".story and .collage: anyone can make them; a collage needs 2 photos", async () => {
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3.2e6, size: 150 }, ME);
  await b.send(".story 1", CLIENT);
  assert.deepEqual(await size(b.last().image), ["jpeg", 1080, 1920]);
  assert.equal(b.last().caption, "#1 — للحالة (Status)");

  await b.send(".collage 1");
  assert.match(b.last().text, /#1 has no photos; a collage needs at least 2/);
  for (const c of [[200, 50, 50], [50, 200, 50], [50, 50, 200], [200, 200, 50], [50, 200, 200]]) re.addPhoto(b.s, b.app.config, 1, await photo(...c));
  await b.send(".collage 1", CLIENT);
  const out = b.last().image;
  assert.deepEqual(await size(out), ["jpeg", 1080, 1350]);
  // The first (red) photo is top right; the fourth tile (bottom left) is darkened under "+1".
  const px = async (x, y) => [...(await sharp(out).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())];
  const [r, g] = await px(900, 300);
  assert.ok(r > 150 && g < 100, "first photo top right");
  const [r4, g4, b4] = await px(100, 700);
  assert.ok(r4 < 150 && g4 < 150 && b4 < 150, "the last tile is darkened for +1");
  await b.send(".collage 99");
  assert.match(b.last().text, /Usage: \.collage <listing number>/);
});
