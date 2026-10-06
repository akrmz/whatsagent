"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const ytdlp = require("../src/services/ytdlp");
const autodl = require("../src/services/autodl");
const todo = require("../src/services/todo");
const { stopAll } = require("../src/services/automations");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const A = "447911123456@s.whatsapp.net";
const B = "447911654321@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000005@g.us";
const CAPS = { ...ALL_OFF, ytdlp: true, ffmpeg: true };

function bot(t, group = GROUP) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: CAPS });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: CAPS }), capabilities: CAPS });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: A }, { id: B }] });
  app.sock = sock;
  const d = createDispatcher(app);
  const calls = [];
  const original = ytdlp.download;
  ytdlp.download = async (config, opts) => {
    calls.push(opts);
    if (opts.target.includes("broken")) throw new Error("Unsupported URL");
    if (opts.target.includes("photos")) return [{ buffer: Buffer.from("jpg"), title: "Two photos", ext: "jpg" }, { buffer: Buffer.from("jpg2"), title: "media", ext: "jpg" }];
    return [{ buffer: Buffer.from("mp4"), title: "A clip", ext: "mp4" }];
  };
  t.after(() => (ytdlp.download = original));
  let n = 0;
  const send = (text, sender = A, quotedText) =>
    d.handleMessage(sock, {
      key: { id: `M${++n}`, remoteJid: group, participant: sender, fromMe: false },
      pushName: "x",
      message: quotedText
        ? { extendedTextMessage: { text, contextInfo: { quotedMessage: { conversation: quotedText }, participant: B, stanzaId: "Q1" } } }
        : { conversation: text },
    });
  const sent = () => sock.sent.map((s) => s.content);
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { app, sock, send, sent, calls, settle };
}

test(".dl takes the link from the replied-to message; photos are sent as photos", async (t) => {
  const b = bot(t);
  await b.send(".dl", A, "look at this https://www.tiktok.com/@user/video/7300000000000000000");
  assert.equal(b.calls[0].target, "https://www.tiktok.com/@user/video/7300000000000000000");
  assert.ok(b.sent().some((c) => c.video && c.caption === "📝 A clip"));

  await b.send(".twitter https://x.com/u/status/1/photos");
  const photos = b.sent().filter((c) => c.image);
  assert.equal(photos.length, 2, "jpg items are images, not broken videos");
  assert.equal(photos[0].caption, "📝 Two photos");
  assert.equal(photos[1].caption, undefined, "caption only once");

  await b.send(".song", A, "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(b.calls.at(-1).target, "https://youtu.be/dQw4w9WgXcQ");
  assert.equal(b.calls.at(-1).search, false);
});

test(".autodl: off by default, admins turn it on, short-video links are downloaded in the background", async (t) => {
  const b = bot(t);
  await b.send("https://www.tiktok.com/@u/video/1");
  await b.settle();
  assert.equal(b.calls.length, 0, "off by default");

  await b.send(".autodl on", A);
  assert.equal(autodl.isOn(b.app.state, GROUP), false, "members can't turn it on");
  await b.send(".autodl on", ADMIN);
  assert.equal(autodl.isOn(b.app.state, GROUP), true);

  await b.send("haha watch https://www.instagram.com/reel/AbC123/ 😂", B);
  await b.settle();
  assert.equal(b.calls.at(-1).target, "https://www.instagram.com/reel/AbC123/");
  assert.equal(b.calls.at(-1).maxItems, autodl.MAX_ITEMS, "carousels: up to 4");
  assert.ok(b.sent().some((c) => c.video));
  assert.ok(b.sent().some((c) => c.react?.text === "✅"));

  const before = b.calls.length;
  await b.send("https://www.tiktok.com/@u/video/2", B);
  await b.settle();
  assert.equal(b.calls.length, before, "15 s between downloads in a group");

  assert.equal(autodl.pickLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null, "long YouTube videos stay manual");
  assert.equal(autodl.pickLink("https://youtube.com/shorts/abcdefghijk")?.site, "youtube");
  assert.equal(autodl.pickLink("https://example.com/video.mp4"), null);
  assert.equal(autodl.take("other-group", 0), null);
  assert.equal(autodl.take("other-group", 1000), "busy");
  autodl.release("other-group");
  assert.equal(autodl.take("other-group", 2000), "cooldown");

  assert.ok(stopAll(b.app.state, GROUP, { all: true }).includes("autodl"));
  assert.equal(autodl.isOn(b.app.state, GROUP), false);
});

test("auto-download failures only get a reaction", async (t) => {
  const b = bot(t, "120363000000000006@g.us");
  autodl.set(b.app.state, "120363000000000006@g.us", true);
  await b.send("https://www.facebook.com/reel/broken/", B);
  await b.settle();
  assert.ok(b.sent().some((c) => c.react?.text === "❌"));
  assert.ok(!b.sent().some((c) => c.text && /Unsupported|failed/i.test(c.text)), "no error text in the group");
});

test(".todo: add, tick off, delete (author or admin), clear (admins)", async (t) => {
  const b = bot(t);
  const last = () => b.sent().filter((c) => c.text).at(-1).text;
  await b.send(".todo");
  assert.match(last(), /empty/);
  await b.send(".todo add Buy the projector", A);
  await b.send(".todo add Book the hall", B);
  assert.match(last(), /Added \*2\.\* Book the hall/);
  await b.send(".todo done 1", B);
  assert.match(last(), /✅ Done: \*1\.\*/);
  await b.send(".todo");
  assert.match(last(), /1 open, 1 done/);
  assert.match(last(), /✅ \*1\.\* ~Buy the projector~/);
  await b.send(".todo del 2", A);
  assert.match(last(), /Only the person who added it/);
  await b.send(".todo del 2", ADMIN);
  assert.match(last(), /Deleted \*2\.\*/);
  await b.send(".todo clear", A);
  assert.match(last(), /Only group admins/);
  await b.send(".todo clear", ADMIN);
  assert.match(last(), /Removed 1 finished/);
  assert.equal(todo.list(b.app.state, GROUP).length, 0);
  await b.send(".todo done 9", A);
  assert.match(last(), /no task #9/);
});
