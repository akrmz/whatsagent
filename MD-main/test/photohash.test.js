"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildContext } = require("../src/core/context");
const re = require("../src/services/realestate");
const drafts = require("../src/services/drafts");
const photohash = require("../src/services/photohash");
const forwardIntake = require("../src/listeners/forwardintake");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");

/** A "photo": a scene drawn in SVG, different per seed. */
const scene = (bg, sun, x) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${bg}"/><circle cx="${x}" cy="300" r="180" fill="${sun}"/><rect x="520" y="80" width="200" height="420" fill="#222"/></svg>`))
    .jpeg({ quality: 90 })
    .toBuffer();

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const forward = (text) => d.handleMessage(sock, { key: { id: `H${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { extendedTextMessage: { text, contextInfo: { isForwarded: true } } } });
  const forwardPhoto = async (jpeg) => {
    const ctx = buildContext(app, sock, { key: { id: `HP${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { imageMessage: { mimetype: "image/jpeg", contextInfo: { isForwarded: true } } } });
    ctx.download = async () => jpeg;
    return forwardIntake.run(ctx);
  };
  return { app, s: app.state, sock, forward, forwardPhoto, captions: () => sock.sent.map((m) => m.content.caption || m.content.text || "") };
}

test("fingerprints: a resized, recompressed or brightened copy is near; another picture isn't", async () => {
  const a = await scene("#88aacc", "#ffcc00", 300);
  const copy = await sharp(a).resize(400).jpeg({ quality: 40 }).toBuffer();
  const brighter = await sharp(a).modulate({ brightness: 1.1 }).jpeg().toBuffer();
  const other = await scene("#335533", "#aa2222", 100);
  const [ha, hc, hb, ho] = await Promise.all([a, copy, brighter, other].map(photohash.dhash));
  assert.match(ha, /^[0-9a-f]{16}$/);
  assert.ok(photohash.distance(ha, hc) <= photohash.NEAR, "resized and recompressed");
  assert.ok(photohash.distance(ha, hb) <= photohash.NEAR, "brighter");
  assert.ok(photohash.distance(ha, ho) > photohash.NEAR + 4, "another picture");
  assert.equal(photohash.distance(ha, ha), 0);
});

test("listing photos are fingerprinted in the background; deleted listings' go; an unreadable file isn't retried", async () => {
  const b = bot();
  const l1 = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME).id;
  re.addPhoto(b.s, b.app.config, l1, await scene("#88aacc", "#ffcc00", 300));
  re.addPhoto(b.s, b.app.config, l1, await scene("#112233", "#ddeeff", 600));
  const l2 = re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME).id;
  re.addPhoto(b.s, b.app.config, l2, await scene("#445566", "#ffffff", 200));
  fs.writeFileSync(re.photoPath(b.app.config, l2, 1), "not a picture");
  assert.equal(await photohash.backfill(b.s, b.app.config, 1), 1, "a few per run");
  assert.equal(await photohash.backfill(b.s, b.app.config), 2);
  assert.equal(await photohash.backfill(b.s, b.app.config), 0, "nothing left, the unreadable one isn't retried");
  re.remove(b.s, b.app.config, l2);
  await photohash.backfill(b.s, b.app.config);
  assert.deepEqual(Object.keys(b.s.store("photohashes", {}).data.items), [String(l1)]);
  assert.deepEqual((await photohash.sameAs(b.s, [await scene("#88aacc", "#ffcc00", 300)])).map((m) => m.id), [l1]);
  assert.deepEqual(await photohash.sameAs(b.s, [await scene("#88aacc", "#ffcc00", 300)], { exclude: l1 }), [], "not with its own photos");
});

test("a forwarded unit whose photo is another listing's is pointed out in its review and when saved (a hint, not a block)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const photo = await scene("#88aacc", "#ffcc00", 300);
  const l1 = re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي - مراسي", price: 9e6, size: 120 }, ME).id;
  re.addPhoto(b.s, b.app.config, l1, photo);
  await photohash.backfill(b.s, b.app.config);

  // Another broker's post of the same chalet: new words, another price, the photo shared again.
  await b.forward("للبيع شاليه لقطة بمراسي 125م بسعر 8.7 مليون");
  await b.forwardPhoto(await sharp(photo).resize(640).jpeg({ quality: 60 }).toBuffer());
  t.mock.timers.setTime(NOW + 3 * 60 * 1000);
  await drafts.runDue(b.app, NOW + 3 * 60 * 1000);
  const review = b.captions().find((c) => c.startsWith("📥 *مسودة #1*"));
  assert.match(review, /⚠️ صورها زي صور #1 — ممكن تكون نفس الوحدة من سمسار تاني/);
  assert.doesNotMatch(review, /شكلها زي #1 المحفوظ/, "the text alone didn't say so");

  const d = createDispatcher(b.app);
  await d.handleMessage(b.sock, { key: { id: "SAVE", remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: ".drafts save 1" } });
  assert.match(b.captions().at(-1), /✅ Draft #1 is now listing \*#2\*[\s\S]*⚠️ صورها زي صور #1 — ممكن تكون نفس الوحدة من سمسار تاني \(لو كده: \.listing del 2\)/);

  // A different unit's photo: nothing said.
  await b.forward("فيلا للبيع في الشيخ زايد 400 متر السعر 15 مليون");
  await b.forwardPhoto(await scene("#335533", "#aa2222", 100));
  t.mock.timers.setTime(NOW + 6 * 60 * 1000);
  await drafts.runDue(b.app, NOW + 6 * 60 * 1000);
  assert.doesNotMatch(b.captions().find((c) => c.startsWith("📥 *مسودة #2*")), /صورها زي/);
  t.mock.timers.reset();
});
