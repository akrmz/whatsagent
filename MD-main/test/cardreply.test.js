"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const media = require("../src/services/listingmedia");
const assistant = require("../src/services/assistant");
const { makeApp, makeSock, ALL_OFF, BOT } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T12:00:00Z");
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
  let n = 0;
  const s = app.state;
  const chalet = re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, size: 120, geo: { lat: 30.9, lng: 28.8 } }, ME).id; // #1
  for (const c of [1, 2, 3]) re.addPhoto(s, app.config, chalet, Buffer.alloc(500, c));
  media.addVideo(s, app.config, chalet, mp4());
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 8.5e6, size: 115 }, ME); // #2, similar
  /** A reply to the bot's card of a listing. */
  const reply = (text, card = re.card(re.get(s, chalet), re.agent(s)), from = CLIENT) =>
    d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { extendedTextMessage: { text, contextInfo: { quotedMessage: { conversation: card }, participant: `${BOT}@s.whatsapp.net`, stanzaId: `Q${n}` } } } });
  const later = () => t.mock.timers.setTime((now += 60000)); // past the 30-second rule
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s, reply, later, to, chalet };
}

test("replies to a listing's card are answered from it: available, photos, video, location", async (t) => {
  const b = bot(t);
  await b.reply("لسه متاحة؟");
  assert.equal(b.to(CLIENT).at(-1).content.text, "✅ أيوه، #1 لسه متاحة.");
  b.later();
  await b.reply("ممكن صور تانية");
  const imgs = b.to(CLIENT).filter((m) => m.content.image);
  assert.equal(imgs.length, 3, "all its photos");
  b.later();
  await b.reply("فيه فيديو؟");
  assert.ok(Buffer.isBuffer(b.to(CLIENT).at(-1).content.video));
  b.later();
  await b.reply("اللوكيشن فين");
  assert.deepEqual(b.to(CLIENT).at(-1).content.location.degreesLatitude, 30.9);

  // A question the bot can't answer from the card goes on (no assistant here: nothing is sent).
  const n = b.to(CLIENT).length;
  await b.reply("بكام المتر؟");
  assert.equal(b.to(CLIENT).length, n);
  // The team's own replies aren't answered.
  await b.reply("لسه متاحة؟", undefined, ME);
  assert.equal(b.to(ME).length, 0);
  // Flood: the same question about the same unit within 30 seconds, once.
  b.later();
  await b.reply("لسه متاحة؟");
  await b.reply("لسه متاحة؟");
  assert.equal(b.to(CLIENT).filter((m) => /لسه متاحة\./.test(m.content.text || "")).length, 2, "the first, and one more a minute later");
  t.mock.timers.reset();
});

test("a sold unit's card: said plainly, with similar available ones", async (t) => {
  const b = bot(t);
  re.update(b.s, b.chalet, { status: "sold" });
  await b.reply("لسه موجود؟");
  assert.match(b.to(CLIENT).at(-1).content.text, /^🔄 العقار #1 اتباع، بس عندنا بديل قريب منه:[\s\S]*#2\*/);
  t.mock.timers.reset();
});

test("the assistant is told which unit a reply to a card is about", (t) => {
  const b = bot(t);
  const l = re.get(b.s, b.chalet);
  const p = assistant.systemPrompt(b.s, null, "بكام المتر؟", { about: l });
  assert.match(p, /The client's message replies to the card of listing #1: unless they say otherwise, they mean that unit/);
  assert.match(p, /CATALOG \([^)]*\):\n#1: /, "first in the catalogue");
  re.update(b.s, b.chalet, { status: "reserved" });
  const g = assistant.systemPrompt(b.s, null, "بكام المتر؟", { about: re.get(b.s, b.chalet) });
  assert.match(g, /listing #1, which is no longer available \(⏳ محجوز\): say so plainly and offer the similar available ones \(#2\)/);
  assert.match(g, /CATALOG \([^)]*\):\n#2: /);
  t.mock.timers.reset();
});
