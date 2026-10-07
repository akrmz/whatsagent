"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const tar = require("../src/services/tar");
const photobackup = require("../src/services/photobackup");
const { makeApp, makeSock, ALL_OFF, OWNER } = require("./helpers");

const JPEG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({ commands: loaded, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  const d = createDispatcher(app);
  const send = (text) => d.handleMessage(sock, { key: { id: `M${Math.random()}`, remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send };
}

function catalogue(app) {
  re.add(app.state, { type: "شقة", location: "التجمع", price: 3e6 }, "x");
  re.add(app.state, { type: "فيلا", location: "زايد", price: 9e6 }, "x");
}

/** Changes one entry's type in an archive (to make a symlink entry), fixing its checksum. */
function withType(gz, index, type) {
  const t = zlib.gunzipSync(gz);
  let off = 0;
  for (let i = 0; i < index; i++) off += 512 + Math.ceil(parseInt(t.subarray(off + 124, off + 135).toString(), 8) / 512) * 512;
  t[off + 156] = type.charCodeAt(0);
  t.fill(" ", off + 148, off + 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += t[off + i];
  t.write(`${sum.toString(8).padStart(6, "0")}\0 `, off + 148, "ascii");
  return zlib.gzipSync(t);
}

test("photos backup → restore into a fresh bot; standard tar archives (with folders) work too", () => {
  const a = bot();
  catalogue(a.app);
  re.addPhoto(a.app.state, a.app.config, 1, JPEG("one-a"));
  re.addPhoto(a.app.state, a.app.config, 1, JPEG("one-b"));
  re.addPhoto(a.app.state, a.app.config, 2, JPEG("two-a"));
  const { buffer, count, listings } = photobackup.create(a.app.state, a.app.config);
  assert.deepEqual([count, listings], [3, 2]);

  const b = bot();
  catalogue(b.app); // the listings come back first, with the normal .restore
  const preview = photobackup.inspect(b.app.state, buffer);
  assert.equal(preview.ok.length, 3);
  assert.equal(re.photos(b.app.config, re.get(b.app.state, 1)).length, 0, "inspect changes nothing");
  const r = photobackup.restore(b.app.state, b.app.config, buffer);
  assert.deepEqual([r.written, r.listings, r.skipped], [3, 2, []]);
  assert.equal(re.get(b.app.state, 1).photos, 2);
  assert.deepEqual(fs.readFileSync(re.photoPath(b.app.config, 1, 2)), JPEG("one-b"));

  // Like "tar -czf photos.tar.gz listings" on the server: folder entries come first.
  const standard = withType(tar.pack([{ name: "listings/", data: Buffer.alloc(0) }, { name: "listings/2/1.jpg", data: JPEG("two-new") }]), 0, "5");
  const s = photobackup.inspect(b.app.state, standard);
  assert.deepEqual([s.ok.length, s.skipped], [1, []], "the folder is ignored, not reported");
});

test("a hostile archive can't write outside the photos folder or plant other files", () => {
  const b = bot();
  catalogue(b.app);
  const dataDir = b.app.config.paths.data;
  let gz = tar.pack([
    { name: "listings/../../evil.jpg", data: JPEG("x") },
    { name: "/tmp/listings/1/1.jpg", data: JPEG("x") },
    { name: "listings/1/../../../evil2.jpg", data: JPEG("x") },
    { name: "listings/1/1.jpg", data: Buffer.from("MZ not a jpeg") },
    { name: "listings/99/1.jpg", data: JPEG("x") },
    { name: "listings/1/11.jpg", data: JPEG("x") },
    { name: "listings/2/1.jpg", data: JPEG("ok") },
    { name: "listings/1/2.jpg", data: JPEG("link") },
  ]);
  gz = withType(gz, 7, "2"); // the last entry becomes a symlink
  const r = photobackup.restore(b.app.state, b.app.config, gz);
  assert.equal(r.written, 1, "only listings/2/1.jpg");
  assert.equal(r.skipped.length, 7);
  assert.match(r.skipped.join("\n"), /evil\.jpg: not a listing photo/);
  assert.match(r.skipped.join("\n"), /\/tmp\/listings\/1\/1\.jpg: not a listing photo/);
  assert.match(r.skipped.join("\n"), /not a JPEG/);
  assert.match(r.skipped.join("\n"), /listing #99 doesn't exist/);
  assert.match(r.skipped.join("\n"), /out of range/);
  assert.match(r.skipped.join("\n"), /listings\/1\/2\.jpg: not a regular file \(link\)/);
  for (const p of [path.join(dataDir, "..", "evil.jpg"), path.join(dataDir, "evil.jpg"), path.join(dataDir, "..", "..", "evil2.jpg"), "/tmp/listings/1/1.jpg"]) {
    assert.equal(fs.existsSync(p), false, `nothing at ${p}`);
  }
  assert.equal(re.get(b.app.state, 1).photos || 0, 0);
  assert.equal(re.get(b.app.state, 2).photos, 1);
});

test("damaged, foreign and oversized archives are refused before anything is written", () => {
  const b = bot();
  catalogue(b.app);
  assert.throws(() => photobackup.inspect(b.app.state, Buffer.from("not an archive")), /isn't a photos backup \(not a \.tar\.gz archive\)/);
  const bomb = zlib.gzipSync(Buffer.alloc(260 * 1024 * 1024));
  assert.throws(() => photobackup.inspect(b.app.state, bomb), /archive too large/, "a zip bomb stops while inflating");
  const t = zlib.gunzipSync(tar.pack([{ name: "listings/1/1.jpg", data: JPEG("x") }]));
  t[0] = "X".charCodeAt(0); // the header no longer matches its checksum
  assert.throws(() => photobackup.inspect(b.app.state, zlib.gzipSync(t)), /checksum/);
  assert.equal(photobackup.isArchive(tar.pack([])), true);
  assert.equal(photobackup.isArchive(Buffer.from("{}")), false);
});

test(".backup photos sends the archive to the owner", async () => {
  const b = bot();
  catalogue(b.app);
  await b.send(".backup photos");
  assert.match(b.sock.sent.at(-1).content.text, /No listing has photos yet/);
  re.addPhoto(b.app.state, b.app.config, 2, JPEG("two"));
  await b.send(".backup photos");
  const doc = b.sock.sent.at(-1).content;
  assert.equal(doc.mimetype, "application/gzip");
  assert.match(doc.fileName, /^listing-photos-\d{4}-\d\d-\d\d\.tar\.gz$/);
  assert.match(doc.caption, /1 photo\(s\) of 1 listing\(s\)/);
  assert.deepEqual(tar.unpack(doc.document).map((e) => e.name), ["listings/2/1.jpg"]);
});
