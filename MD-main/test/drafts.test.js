"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const { proto } = require("@whiskeysockets/baileys");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildContext } = require("../src/core/context");
const re = require("../src/services/realestate");
const drafts = require("../src/services/drafts");
const channels = require("../src/services/channels");
const forwardIntake = require("../src/listeners/forwardintake");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const CHANNEL = "120363111111111111@newsletter";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");
const MIN = 60 * 1000;

const POST = "🏖️ شاليه للبيع في الساحل الشمالي - مراسي\nصف أول فيو بحر\n120 متر 2 غرف\nالسعر 9 مليون مقدم 2 مليون والباقي على 5 سنين\nللتواصل 01001234567";
const POST2 = "شقة للبيع في التجمع الخامس 150 متر 3 غرف السعر 3.5 مليون\nواتساب +201005556666";

async function jpegOf(color) {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).jpeg().toBuffer();
}

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const raw = (message, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `F${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message });
  const send = (text, opts) => raw({ conversation: text }, opts);
  const forward = (text, opts) => raw({ extendedTextMessage: { text, contextInfo: { isForwarded: true, forwardingScore: 1 } } }, opts);
  /** A forwarded photo, through the listener with the download stubbed (no WhatsApp here). */
  const forwardPhoto = async (jpeg, { from = ME, caption } = {}) => {
    const ctx = buildContext(app, sock, { key: { id: `P${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { imageMessage: { mimetype: "image/jpeg", fileLength: jpeg.length, ...(caption ? { caption } : {}), contextInfo: { isForwarded: true } } } });
    ctx.download = async () => jpeg;
    return forwardIntake.run(ctx);
  };
  const texts = (jid) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || m.content.caption || "");
  return { app, s: app.state, sock, d, raw, send, forward, forwardPhoto, texts, last: (jid = ME) => texts(jid).at(-1) || "" };
}

test("forwarded posts with their photos become drafts, split by unit, checked, then saved as listings with the photos", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.forward(POST);
  assert.match(b.last(), /^📥 بجمّع الوحدة في مسودة #1…/);
  assert.equal(await b.forwardPhoto(await jpegOf("#88aacc")), "stop");
  assert.equal(await b.forwardPhoto(await jpegOf("#aa8866")), "stop");
  t.mock.timers.setTime(NOW + 30 * 1000);
  await b.forward(POST2); // the next unit, within the 2 minutes
  await b.forwardPhoto(await jpegOf("#66aa88"));
  assert.deepEqual(drafts.open(b.s).map((d) => [d.id, d.photos]), [[1, 2], [2, 1]]);
  assert.equal(b.texts(ME).filter((x) => x.startsWith("📥 بجمّع")).length, 2, "one note per draft, not per photo");

  // Not yet: still within 2 minutes of the last message.
  assert.equal(await drafts.runDue(b.app, NOW + 60 * 1000), 0);
  t.mock.timers.setTime(NOW + 3 * MIN);
  assert.equal(await drafts.runDue(b.app, NOW + 3 * MIN), 2);
  const review = b.sock.sent.filter((m) => m.content.caption?.startsWith("📥 *مسودة #1*")).at(-1);
  assert.ok(review?.content.image, "with its first photo");
  const r = review.content.caption;
  assert.match(r, /— من الرسائل اللي حوّلتها/);
  assert.match(r, /🏠 \*شاليه للبيع\*/);
  assert.match(r, /9,000,000/);
  assert.match(r, /💳 مقدم 2,000,000/);
  assert.match(r, /📷 2 صورة/);
  assert.match(r, /📞 أرقام في البوست \(خاصة، مش هتظهر في الكارت\): \+201001234567/);
  assert.doesNotMatch(r.split("📷")[0], /01001234567|201001234567/, "the broker's number isn't in the card");
  assert.match(r, /احفظها: \.drafts save 1/);
  assert.equal(await drafts.runDue(b.app, NOW + 4 * MIN), 0, "each draft is shown once");

  await b.send(".drafts");
  assert.match(b.last(), /📥 \*Drafts\* \(2\)\n\n▫️ \*#1\* شاليه لل(بيع|بيع) — الساحل الشمالي - مراسي — 9 مليون · 📷 2 · ↪️\n▫️ \*#2\* شقة/);
  await b.send(".drafts save 1");
  assert.match(b.last(), /^✅ Draft #1 is now listing \*#1\* with 2 photo\(s\)\./);
  const l = re.get(b.s, 1);
  assert.deepEqual([l.type, l.deal, l.price, l.size, l.rooms, l.down, l.years, l.photos], ["شاليه", "بيع", 9e6, 120, 2, 2e6, 5, 2]);
  assert.deepEqual(re.featuresOf(l).sort(), ["صف أول", "فيو بحر"].sort());
  const { source, ...shown } = l;
  assert.doesNotMatch(JSON.stringify(shown), /01001234567|201001234567/, "no broker number in what can be shown");
  assert.deepEqual([source.kind, source.phones], ["forward", ["201001234567"]], "kept privately: who to call about it");
  assert.doesNotMatch(re.card(l, re.agent(b.s)), /1001234567/);
  assert.equal(re.photos(b.app.config, l).length, 2);
  assert.equal(drafts.get(b.s, 1), null);
  assert.equal(fs.existsSync(require("node:path").join(b.app.config.paths.data, "drafts", "1")), false, "the draft's photos are moved, not copied");

  await b.send(".drafts save 2 السعر: 3.2 مليون\nالمالك: أبو أحمد 0100 777 8888");
  const l2 = re.get(b.s, 2);
  assert.deepEqual([l2.type, l2.price, l2.owner?.name, l2.owner?.phone], ["شقة", 3.2e6, "أبو أحمد", "201007778888"], "edits win, an owner can be given");
  t.mock.timers.reset();
});

test("only the owner's or a sudo user's own chat collects; ordinary messages and other people's forwards don't", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send("شاليه للبيع في الساحل 9 مليون"); // typed, not forwarded
  await b.forward("صباح الخير، اتأخرت شوية"); // forwarded, not a property
  await b.forward("عايز شقة في التجمع 3 غرف ميزانية 3 مليون"); // a client's request, forwarded to add them
  await b.forward(POST, { from: CLIENT }); // a client forwarding to the bot
  await b.forward(POST, { from: ME, chat: GROUP }); // in a group
  assert.equal(drafts.open(b.s).length, 0);
  await b.send(".drafts off");
  await b.forward(POST);
  assert.equal(drafts.open(b.s).length, 0, "off");
  await b.send(".drafts on");
  await b.forward(POST);
  await b.send("وفيها جراج"); // while collecting, a typed line joins
  assert.match(drafts.open(b.s)[0].texts.join("\n"), /وفيها جراج$/);
  await b.send(".drafts", { from: ME, chat: GROUP });
  assert.match(b.last(GROUP), /^🔒/, "drafts carry numbers: not in a group with outsiders");
  t.mock.timers.reset();
});

test("a channel: added by its link, its live posts and photos become drafts; recent posts can be imported once", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const followed = [];
  b.sock.newsletterMetadata = async (type, key) => (type === "invite" && key === "0029VaABCDEFGHIJKLMN" ? { id: CHANNEL, thread_metadata: { name: { text: "عقارات الساحل" } }, viewer_metadata: { role: "GUEST" } } : null);
  b.sock.newsletterFollow = async (jid) => followed.push(jid);
  b.sock.subscribeNewsletterUpdates = async () => ({ duration: "300" });
  const photo = await jpegOf("#3366aa");
  const fetched = [];
  channels.setRequester(async (url, opts) => {
    fetched.push([url, opts.maxBytes]);
    return { body: photo };
  });
  t.after(() => channels.setRequester(null));

  await b.send(".channel add https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXX");
  assert.match(b.last(), /^❌ Couldn't find that channel/);
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN");
  assert.match(b.last(), /^✅ Reading the channel \*عقارات الساحل\*\./);
  assert.deepEqual(followed, [CHANNEL]);

  // A live post: a photo with the caption.
  const post = (id, message) => b.raw(message, { from: CHANNEL, chat: CHANNEL }).then(() => id);
  await post("A1", { imageMessage: { caption: POST, mimetype: "image/jpeg", directPath: "/o1/v/t62.7118-24/f1/m1/abc.enc?ccb=11-4" } });
  await post("A2", { imageMessage: { mimetype: "image/jpeg", directPath: "/o1/v/t62.7118-24/f1/m1/def.enc" } });
  assert.deepEqual(fetched.map(([u, max]) => [new URL(u).hostname, max]), [["mmg.whatsapp.net", 15 * 1024 * 1024], ["mmg.whatsapp.net", 15 * 1024 * 1024]]);
  let [dr] = drafts.open(b.s);
  assert.deepEqual([dr.source.kind, dr.source.name, dr.photos], ["channel", "عقارات الساحل", 2]);

  // A path to another host, or a non-image, isn't kept; a command in a channel does nothing.
  await post("A3", { imageMessage: { mimetype: "image/jpeg", directPath: "//evil.example/x.jpg", url: "https://evil.example/x.jpg" } });
  assert.equal(fetched.length, 2, "never fetched from elsewhere");
  const before = b.sock.sent.length;
  await b.raw({ conversation: ".menu" }, { from: CHANNEL, chat: CHANNEL });
  assert.equal(b.sock.sent.length, before, "channel posts never run commands");
  // A channel nobody added is ignored.
  await b.raw({ conversation: POST2 }, { from: "120363999999999999@newsletter", chat: "120363999999999999@newsletter" });
  assert.equal(drafts.open(b.s).length, 1);

  t.mock.timers.setTime(NOW + 3 * MIN);
  await drafts.runDue(b.app, NOW + 3 * MIN);
  assert.match(b.texts(ME).find((x) => x.startsWith("📥 *مسودة #1*")), /من قناة "عقارات الساحل"/);

  // Importing recent posts: the shape of a fetch reply, decoded like live posts; twice is once.
  const node = (posts) => ({ tag: "iq", attrs: {}, content: [{ tag: "message_updates", attrs: {}, content: [{ tag: "messages", attrs: {}, content: posts }] }] });
  const msg = (serverId, t0, message) => ({ tag: "message", attrs: { server_id: serverId, t: String(t0) }, content: [{ tag: "plaintext", attrs: {}, content: proto.Message.encode(message).finish() }] });
  const t1 = Math.floor((NOW - 2 * 86400000) / 1000);
  b.sock.newsletterFetchMessages = async (jid, count) => {
    assert.equal(count, 20);
    return node([msg("201", t1 + 30, { imageMessage: { mimetype: "image/jpeg", directPath: "/o1/v/a.enc" } }), msg("200", t1, { conversation: POST2 }), msg("202", t1 + 3600, { conversation: "تهنئة بالعيد 🌙" })]);
  };
  await b.send(".channel import 1 20");
  assert.match(b.last(), /3 recent post\(s\) read, 2 new draft\(s\)/);
  const imported = drafts.open(b.s).filter((d) => d.source.kind === "channel" && d.id > 1);
  assert.deepEqual(imported.map((d) => [d.texts[0].slice(0, 4), d.photos]), [["شقة ", 1], ["تهنئ", 0]], "the text and its photo a minute later are one unit");
  await b.send(".channel import 1 20");
  assert.match(b.last(), /0 new draft\(s\)/);
  t.mock.timers.reset();
});

test("a channel with auto: posts that read as a property become listings straight away; the rest wait", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  b.sock.newsletterMetadata = async () => ({ id: CHANNEL, name: "قناتي", viewer_metadata: { role: "OWNER" } });
  b.sock.newsletterFollow = async () => assert.fail("an owner of the channel isn't made to follow it");
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN auto");
  assert.match(b.last(), /becomes a listing straight away/);
  await b.raw({ conversation: POST2 }, { from: CHANNEL, chat: CHANNEL });
  t.mock.timers.setTime(NOW + 3 * MIN);
  await b.raw({ conversation: "جمعة مباركة" }, { from: CHANNEL, chat: CHANNEL });
  t.mock.timers.setTime(NOW + 6 * MIN);
  await drafts.runDue(b.app, NOW + 6 * MIN);
  assert.equal(re.all(b.s).length, 1);
  assert.match(b.texts(ME).find((x) => x.startsWith("✅ اتضاف")), /^✅ اتضاف \*#1\* من قناة "قناتي"/);
  assert.equal(drafts.open(b.s).length, 1, "the greeting waits as a draft");
  await b.send(".channel list");
  assert.match(b.last(), /1\. \*قناتي\* · ⚡ auto/);
  t.mock.timers.reset();
});

test("what outside posts can store is bounded: 50 drafts, 10 photos each, gone after 14 days", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const src = (i) => ({ kind: "channel", key: `ch:${i}`, name: "x" });
  for (let i = 0; i < drafts.MAX_OPEN; i++) drafts.collect(b.s, b.app.config, { source: src(i), text: `شقة ${i}` });
  assert.deepEqual(drafts.collect(b.s, b.app.config, { source: src(99), text: "شقة" }), { full: true });
  const jpeg = await jpegOf("#123456");
  const one = drafts.open(b.s)[0];
  for (let i = 0; i < drafts.MAX_PHOTOS; i++) drafts.collect(b.s, b.app.config, { source: one.source, jpeg });
  assert.deepEqual(drafts.collect(b.s, b.app.config, { source: one.source, jpeg }), { skipped: "photos" });
  assert.equal(drafts.get(b.s, one.id).photos, drafts.MAX_PHOTOS);
  drafts.expire(b.s, b.app.config, NOW + 15 * 86400000);
  assert.equal(drafts.open(b.s).length, 0);
  assert.equal(fs.existsSync(require("node:path").join(b.app.config.paths.data, "drafts", String(one.id))), false);
  t.mock.timers.reset();
});
