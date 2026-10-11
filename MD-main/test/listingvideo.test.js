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
const media = require("../src/services/listingmedia");
const channels = require("../src/services/channels");
const { groupData } = require("../src/services/settings");
const forwardIntake = require("../src/listeners/forwardintake");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const SUDO = "201033334444@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const CHANNEL = "120363111111111111@newsletter";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");

/** A tiny MP4: "ftyp" at byte 4, as every MP4/MOV starts. */
const mp4 = (fill = 1) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(200, fill)]);
const jpegOf = (c) => sharp({ create: { width: 30, height: 20, channels: 3, background: c } }).jpeg().toBuffer();

function bot() {
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
  const raw = (message, from = ME, chat = from) => d.handleMessage(sock, { key: { id: `V${++n}`, remoteJid: chat, fromMe: false }, pushName: "x", message });
  const send = (text, from) => raw({ conversation: text }, from);
  const forward = (text, from) => raw({ extendedTextMessage: { text, contextInfo: { isForwarded: true } } }, from);
  /** A forwarded photo or video, through the listener with the download stubbed (no WhatsApp). */
  const forwardMedia = async (kind, buf, { from = ME, size } = {}) => {
    const key = kind === "video" ? "videoMessage" : "imageMessage";
    const ctx = buildContext(app, sock, { key: { id: `M${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { [key]: { mimetype: kind === "video" ? "video/mp4" : "image/jpeg", fileLength: size ?? buf.length, contextInfo: { isForwarded: true } } } });
    ctx.download = async () => buf;
    return forwardIntake.run(ctx);
  };
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s: app.state, sock, send, forward, forwardMedia, to, raw, last: (jid = ME) => to(jid).map((m) => m.content.text || m.content.caption || "").at(-1) || "" };
}

test("a forwarded unit's video joins its draft and the listing; clients get it with #12 فيديو, not with every card", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.forward("شاليه للبيع في الساحل الشمالي 120 متر السعر 9 مليون");
  await b.forwardMedia("image", await jpegOf("#88aacc"));
  await b.forwardMedia("video", mp4());
  await b.forwardMedia("video", Buffer.from("not a video at all, just bytes"));
  const [d] = drafts.open(b.s);
  assert.deepEqual([d.photos, d.videos], [1, 1], "a file that isn't a video isn't kept");
  assert.match(drafts.reviewText(b.s, d), /📷 1 صورة · 🎥 1 فيديو/);

  await b.send(".drafts save 1");
  const l = re.get(b.s, 1);
  assert.equal(l.videos, 1);
  assert.deepEqual(fs.readFileSync(media.videoPath(b.app.config, 1, 1)), mp4());

  await b.send("#1", CLIENT);
  const card = b.to(CLIENT).at(-1).content;
  assert.ok(card.image && !card.video, "the card goes with its photo, not the video");
  assert.match(card.caption, /🎥 فيه فيديو للوحدة: ابعت #1 فيديو/);
  await b.send("#1 فيديو", CLIENT);
  const v = b.to(CLIENT).at(-1).content;
  assert.ok(Buffer.isBuffer(v.video));
  assert.match(v.caption, /^🎥 #1 شاليه — الساحل الشمالي/);
  assert.equal(re.get(b.s, 1).stats.views, 2, "asking for the video counts as interest");
  t.mock.timers.reset();
});

test("a video over 16 MB is refused politely; a draft takes 2 videos", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.forward("فيلا للبيع في زايد السعر 15 مليون");
  await b.forwardMedia("video", mp4(), { size: 20 * 1024 * 1024 });
  assert.match(b.last(), /🎥 الفيديو ده أكبر من 16 ميجا/);
  await b.forwardMedia("video", mp4(1));
  await b.forwardMedia("video", mp4(2));
  await b.forwardMedia("video", mp4(3));
  assert.equal(drafts.open(b.s)[0].videos, 2);
  assert.match(b.last(), /معاها 2 فيديو خلاص/);
  t.mock.timers.reset();
});

test("photos and videos of a listing: delete one, choose the cover; the fingerprints are made again", async () => {
  const b = bot();
  const id = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME).id;
  const [p1, p2, p3] = await Promise.all(["#111111", "#555555", "#999999"].map(jpegOf));
  for (const p of [p1, p2, p3]) re.addPhoto(b.s, b.app.config, id, p);
  await b.send(`.listing photo ${id} cover 3`);
  assert.match(b.last(), /Photo 3 is now the first photo of #1/);
  assert.deepEqual(fs.readFileSync(re.photoPath(b.app.config, id, 1)), p3);
  assert.deepEqual(fs.readFileSync(re.photoPath(b.app.config, id, 3)), p1);
  await b.send(`.listing photo ${id} del 2`);
  assert.match(b.last(), /Photo 2 of #1 deleted \(2 left\)/);
  assert.deepEqual(fs.readFileSync(re.photoPath(b.app.config, id, 2)), p1, "the later ones move down");
  assert.equal(fs.existsSync(re.photoPath(b.app.config, id, 3)), false);
  assert.equal(b.s.store("photohashes", { items: {} }).data.items[id], undefined, "fingerprinted again later");

  media.addVideo(b.s, b.app.config, id, mp4(1));
  media.addVideo(b.s, b.app.config, id, mp4(2));
  assert.throws(() => media.addVideo(b.s, b.app.config, id, mp4(3)), /can have 2 videos/);
  assert.throws(() => media.addVideo(b.s, b.app.config, id, Buffer.from("x".repeat(40))), /isn't a video file/);
  await b.send(`.listing video ${id} del 1`);
  assert.equal(re.get(b.s, id).videos, 1);
  assert.deepEqual(fs.readFileSync(media.videoPath(b.app.config, id, 1)), mp4(2));
  await b.send(`.listing ${id} video`);
  assert.ok(Buffer.isBuffer(b.to(ME).at(-1).content.video));
  await b.send(`.listing photo ${id} del 9`);
  assert.match(b.last(), /^❌ #1 has 2 photo\(s\)/);
});

test("a sudo user forwards, edits and saves a unit like the owner: details added, a photo dropped, the cover chosen", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.forward("شقة للبيع في المعادي 140 متر السعر 4 مليون", SUDO);
  assert.match(b.last(SUDO), /^📥 بجمّع الوحدة في مسودة #1/);
  const [a, c, e] = await Promise.all(["#123456", "#654321", "#abcdef"].map(jpegOf));
  for (const p of [a, c, e]) await b.forwardMedia("image", p, { from: SUDO });
  await b.send(".drafts edit 1 السعر: 3.8 مليون\nالدور: الخامس", SUDO);
  assert.match(b.to(SUDO).map((m) => m.content.text || m.content.caption || "").join("\n"), /✏️ Added to draft #1\./);
  await b.send(".drafts photo 1 del 2", SUDO);
  assert.match(b.last(SUDO), /Photo 2 of draft #1 deleted \(📷 2 left\)/);
  await b.send(".drafts photo 1 cover 2", SUDO);
  await b.send(".drafts save 1", SUDO);
  const l = re.get(b.s, 1);
  assert.deepEqual([l.price, l.floor, l.photos], [3.8e6, "الخامس", 2], "the edit won over the post's price");
  assert.equal(l.by, SUDO);
  const firstNow = fs.readFileSync(re.photoPath(b.app.config, 1, 1));
  assert.equal(Buffer.compare(firstNow, fs.readFileSync(re.photoPath(b.app.config, 1, 2))) !== 0, true);
  t.mock.timers.reset();
});

test("a channel post's video comes in like its photos (WhatsApp's media server only, checked as a video)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  b.sock.newsletterMetadata = async () => ({ id: CHANNEL, name: "قناة", viewer_metadata: { role: "OWNER" } });
  const fetched = [];
  channels.setRequester(async (url, opts) => {
    fetched.push([new URL(url).hostname, opts.maxBytes]);
    return { body: mp4(7) };
  });
  t.after(() => channels.setRequester(null));
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN");
  await b.raw({ videoMessage: { caption: "شقة للبيع في التجمع السعر 3 مليون", mimetype: "video/mp4", directPath: "/o1/v/t62/v.enc" } }, CHANNEL, CHANNEL);
  assert.deepEqual(fetched, [["mmg.whatsapp.net", 16 * 1024 * 1024]]);
  assert.equal(drafts.open(b.s)[0].videos, 1);
  t.mock.timers.reset();
});
