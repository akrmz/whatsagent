"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const media = require("../src/services/listingmedia");
const storage = require("../src/services/storage");
const { groupData } = require("../src/services/settings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const SUDO = "201033334444@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 86400000;
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(5000, 1)]);
const jpg = (n) => Buffer.alloc(3000 + n, n); // stored as given: only sizes matter here

function bot(t) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW - 100 * DAY });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  groupData(app.state).update((d) => (d.sudo = [SUDO]));
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `S${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  const add = (status, photos, videos) => {
    const id = re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME).id;
    for (let i = 1; i <= photos; i++) re.addPhoto(s, app.config, id, jpg(i));
    for (let i = 1; i <= videos; i++) media.addVideo(s, app.config, id, mp4());
    if (status) re.update(s, id, { status });
    return id;
  };
  const gone = add("sold", 3, 1); // #1 sold 100 days ago
  t.mock.timers.setTime(NOW - 10 * DAY);
  const recent = add("rented", 2, 0); // #2 rented 10 days ago
  t.mock.timers.setTime(NOW);
  const live = add(null, 3, 1); // #3 available
  const dir = (id) => path.dirname(re.photoPath(app.config, id, 1));
  fs.writeFileSync(path.join(dir(live), "1.wm-abcdef1234.jpg"), Buffer.alloc(2000)); // a watermarked copy
  fs.mkdirSync(app.config.paths.tmp, { recursive: true });
  const oldTmp = path.join(app.config.paths.tmp, "old.bin");
  const newTmp = path.join(app.config.paths.tmp, "new.bin");
  fs.writeFileSync(oldTmp, Buffer.alloc(1000));
  fs.utimesSync(oldTmp, new Date(NOW - 3 * DAY), new Date(NOW - 3 * DAY));
  fs.writeFileSync(newTmp, Buffer.alloc(1000));
  fs.mkdirSync(path.join(app.config.paths.tmp, "work"), { recursive: true });
  return { app, s, send, gone, recent, live, dir, oldTmp, newTmp, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "" };
}

test(".storage: where the disk goes, and what can be cleaned", async (t) => {
  const b = bot(t);
  await b.send(".storage");
  const r = b.last();
  assert.match(r, /^💾 \*Storage\* — [\d.]+ MB used by the bot/);
  assert.match(r, /📷 listing photos: [\d.]+ MB \(8\)/);
  assert.match(r, /🎥 listing videos: [\d.]+ MB \(2\)/);
  assert.match(r, /🏷️ watermarked copies: [\d.]+ MB \(1\)/);
  assert.match(r, /🧪 temporary files: [\d.]+ MB \(2\)/);
  assert.match(r, /can be cleaned without losing anything that matters: \.storage clean/);
  assert.equal(re.get(b.s, b.gone).statusAt, NOW - 100 * DAY, "when it was sold is kept");
  t.mock.timers.reset();
});

test(".storage clean: shows first; then only watermarked copies, gone units' extras and old temp files go", async (t) => {
  const b = bot(t);
  await b.send(".storage clean");
  assert.match(b.last(), /^🧹 \*Can be cleaned:\* 5 file\(s\)[\s\S]*units sold or rented 90\+ days ago \(their first photo stays\): #1\n[\s\S]*\.storage clean confirm/);
  assert.equal(fs.existsSync(re.photoPath(b.app.config, b.gone, 2)), true, "nothing removed yet");

  await b.send(".storage clean confirm");
  assert.match(b.last(), /^🧹 Removed 5 file\(s\)/);
  const gone = re.get(b.s, b.gone);
  assert.deepEqual([gone.photos, gone.videos], [1, 0]);
  assert.equal(fs.existsSync(re.photoPath(b.app.config, b.gone, 1)), true, "its first photo stays");
  assert.equal(fs.existsSync(re.photoPath(b.app.config, b.gone, 2)), false);
  assert.equal(fs.existsSync(media.videoPath(b.app.config, b.gone, 1)), false);
  assert.deepEqual([re.get(b.s, b.live).photos, re.get(b.s, b.live).videos, re.get(b.s, b.recent).photos], [3, 1, 2], "available and recently rented untouched");
  assert.equal(fs.existsSync(media.videoPath(b.app.config, b.live, 1)), true);
  assert.equal(fs.readdirSync(b.dir(b.live)).some((f) => f.includes(".wm-")), false, "the copy goes (made again when needed)");
  assert.deepEqual([fs.existsSync(b.oldTmp), fs.existsSync(b.newTmp), fs.existsSync(path.join(b.app.config.paths.tmp, "work"))], [false, true, true]);

  await b.send(".storage clean");
  assert.match(b.last(), /^✅ Nothing to clean/);
  await b.send(".storage", SUDO);
  assert.doesNotMatch(b.last(SUDO), /Storage/, "owner only");
  t.mock.timers.reset();
});

test("temporary files are only ever cleaned in the bot's own tmp folder", () => {
  const c = (tmp) => ({ paths: { tmp: path.resolve(tmp), data: path.resolve("data"), session: path.resolve("session") } });
  assert.equal(storage.safeTmp(c("tmp")), true);
  for (const bad of [".", "data", "/", "../tmp", "C:/Windows/Temp", "/tmp/elsewhere/../../tmp", "src"]) assert.equal(storage.safeTmp(c(bad)), false, bad);
});
