"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const media = require("../src/services/listingmedia");
const mediawait = require("../src/services/mediawait");
const { makeApp, makeSock, ALL_OFF, BOT } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const CLIENT2 = "201077776666@s.whatsapp.net";
const NOW = Date.parse("2026-10-12T12:00:00+03:00");
const MIN = 60 * 1000;
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(100, 1)]);

function bot(t) {
  let now = NOW;
  t.mock.timers.enable({ apis: ["Date"], now });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  const s = app.state;
  const id = re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, size: 120 }, ME).id; // #1: no photos, video or pin
  let n = 0;
  /** A reply to the bot's card of #1. */
  const reply = (text, from = CLIENT) =>
    d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { extendedTextMessage: { text, contextInfo: { quotedMessage: { conversation: re.card(re.get(s, id), re.agent(s)) }, participant: `${BOT}@s.whatsapp.net`, stanzaId: `Q${n}` } } } });
  const send = (text, from = CLIENT) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const later = (ms = MIN) => t.mock.timers.setTime((now += ms));
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  const fill = () => {
    re.addPhoto(s, app.config, id, Buffer.alloc(500, 1));
    re.addPhoto(s, app.config, id, Buffer.alloc(500, 2));
    media.addVideo(s, app.config, id, mp4());
    re.update(s, id, { geo: { lat: 30.9, lng: 28.8 } });
  };
  return { app, s, id, reply, send, later, to, fill, now: () => now };
}

test("a client promised photos, a video and the pin gets them by themselves once they are added", async (t) => {
  const b = bot(t);
  await b.reply("ممكن صور؟");
  assert.equal(b.to(CLIENT).at(-1).content.text, "مفيش صور لـ #1 لسه، هبعتهالك أول ما توصل 🙏");
  assert.match(b.to(ME).at(-1).content.text, /^📸 عميل مستني الصور بتاعة #1 شاليه — الساحل الشمالي \(مفيش لسه\)\.\nأول ما تضيفها هتتبعتلهم لوحدها: \.listing photo 1/);
  b.later();
  await b.reply("اللوكيشن فين؟");
  assert.equal(b.to(CLIENT).at(-1).content.text, "📍 #1 في الساحل الشمالي. اللوكيشن بالظبط هبعتهولك أول ما يوصل 🙏");
  b.later();
  await b.send("#1 فيديو");
  assert.equal(b.to(CLIENT).at(-1).content.text, "مفيش فيديو للعقار #1 لسه، هبعتهولك أول ما يوصل 🙏");
  const told = b.to(ME).length;
  await b.reply("فيه صور؟", CLIENT2);
  assert.equal(b.to(ME).length, told, "the agent is told once a day per listing and kind");

  assert.equal(await mediawait.runDue(b.app, b.now()), 0, "nothing yet");
  b.fill();
  assert.equal(await mediawait.runDue(b.app, b.now()), 0, "just added: first seen");
  b.later(5 * MIN);
  assert.equal(await mediawait.runDue(b.app, b.now()), 0, "photos added one by one: 10 minutes to settle");
  b.later(6 * MIN);
  const before = b.to(CLIENT).length;
  assert.equal(await mediawait.runDue(b.app, b.now()), 4, "photos and video and pin to the first, photos to the second");
  const got = b.to(CLIENT).slice(before);
  assert.equal(got.filter((m) => m.content.image).length, 2);
  assert.equal(got.find((m) => m.content.image).content.caption, "📸 صور #1 اللي طلبتها");
  assert.equal(got.find((m) => m.content.video).content.caption, "🎥 فيديو #1 اللي طلبته");
  assert.equal(got.find((m) => m.content.location).content.location.degreesLatitude, 30.9);
  assert.equal(b.to(CLIENT2).filter((m) => m.content.image).length, 2);
  assert.deepEqual(mediawait.waiting(b.s), [], "kept: nothing left waiting");
  assert.equal(await mediawait.runDue(b.app, b.now() + 20 * MIN), 0, "and only once");
  t.mock.timers.reset();
});

test("not remembered for the team; not sent outside the sending hours, for a unit no longer available, or to a client who said وقف", async (t) => {
  const b = bot(t);
  await b.send("#1 فيديو", ME);
  assert.deepEqual(mediawait.waiting(b.s), [], "staff");
  await b.reply("ممكن صور؟");
  await b.reply("ممكن صور؟", CLIENT2);
  const lead = leads.add(b.s, { name: "س", phone: "201077776666" }, ME);
  leads.setOptOut(b.s, lead.id, true);
  b.fill();
  await mediawait.runDue(b.app, b.now());
  const night = Date.parse("2026-10-12T22:30:00+03:00");
  t.mock.timers.setTime(night);
  assert.equal(await mediawait.runDue(b.app, night), 0, "after the sending hours");
  const morning = Date.parse("2026-10-13T10:05:00+03:00");
  t.mock.timers.setTime(morning);
  assert.equal(await mediawait.runDue(b.app, morning), 1, "the next morning, to the one who didn't say stop");
  assert.equal(b.to(CLIENT2).filter((m) => m.content.image).length, 0);

  // A unit sold meanwhile: the request is dropped.
  const other = re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 2e7 }, ME).id;
  await b.send(`#${other} فيديو`);
  re.update(b.s, other, { status: "sold" });
  await mediawait.runDue(b.app, morning + MIN);
  assert.deepEqual(mediawait.waiting(b.s), []);
  t.mock.timers.reset();
});
