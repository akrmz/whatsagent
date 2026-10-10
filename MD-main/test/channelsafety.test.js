"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const drafts = require("../src/services/drafts");
const channels = require("../src/services/channels");
const campaigns = require("../src/services/campaigns");
const places = require("../src/services/places");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CHANNEL = "120363111111111111@newsletter";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");
const MIN = 60 * 1000;

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  sock.newsletterMetadata = async () => ({ id: CHANNEL, name: "قناة", viewer_metadata: { role: "OWNER" } });
  const d = createDispatcher(app);
  let n = 0;
  const raw = (message, { from = ME, chat = from } = {}) => d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: chat, fromMe: false }, pushName: "x", message });
  const send = (text) => raw({ conversation: text });
  const post = (message) => raw(message, { from: CHANNEL, chat: CHANNEL });
  return { app, s: app.state, sock, send, post, toMe: () => sock.sent.filter((m) => m.jid === ME).map((m) => m.content.text || m.content.caption || "") };
}

test("B-26: nothing is downloaded for a channel post that wouldn't be kept; the owner hears about it once", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const photo = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#123456" } }).jpeg().toBuffer();
  let fetched = 0;
  channels.setRequester(async () => {
    fetched++;
    return { body: photo };
  });
  t.after(() => channels.setRequester(null));
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN");
  for (let i = 0; i < drafts.MAX_OPEN; i++) drafts.collect(b.s, b.app.config, { source: { kind: "forward", key: `fwd:${i}` }, text: `شقة ${i}` });

  await b.post({ imageMessage: { caption: "شقة للبيع في التجمع 3 مليون", mimetype: "image/jpeg", directPath: "/o1/v/x.enc" } });
  await b.post({ imageMessage: { mimetype: "image/jpeg", directPath: "/o1/v/y.enc" } });
  assert.equal(fetched, 0, "the drafts are full: no photo fetched");
  const notes = b.toMe().filter((x) => x.startsWith("📥 بوستات من قناة"));
  assert.equal(notes.length, 1, "told once, not per post");
  assert.match(notes[0], /المسودات المستنية وصلت 50/);

  // Room again: a post is fetched and kept.
  drafts.remove(b.s, b.app.config, 1);
  await b.post({ imageMessage: { caption: "فيلا للبيع في زايد 9 مليون", mimetype: "image/jpeg", directPath: "/o1/v/z.enc" } });
  assert.equal(fetched, 1);
  assert.equal(b.app.store.recent(CHANNEL).length, 0, "channel posts don't fill the message store");
  t.mock.timers.reset();
});

test("B-26: a channel brings at most 120 posts an hour", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN");
  for (let i = 0; i < 120; i++) await b.post({ conversation: `سطر ${i}` });
  const before = drafts.open(b.s).reduce((a, d) => a + d.texts.length, 0);
  await b.post({ conversation: "سطر زيادة" });
  assert.equal(drafts.open(b.s).reduce((a, d) => a + d.texts.length, 0), before, "the 121st post of the hour is left");
  assert.equal(b.toMe().filter((x) => x.startsWith("📥 بوستات من قناة")).length, 1);
  t.mock.timers.setTime(NOW + 61 * MIN);
  await b.post({ conversation: "سطر بعد ساعة" });
  assert.ok(drafts.open(b.s).some((d) => d.texts.includes("سطر بعد ساعة")), "the next hour, posts come in again");
  t.mock.timers.reset();
});

test("B-27: a channel post added with auto never reaches clients unreviewed: no campaign, no links but Maps", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  places.setRequester(async () => ({ status: 302, redirect: "https://www.google.com/maps/place/@30.0074,31.4913,17z" }));
  t.after(() => places.setRequester(null));
  const b = bot();
  leads.add(b.s, { name: "منى", phone: "201001110001", type: "شقة", deal: "بيع", location: "التجمع" }, ME);
  await b.send(".agent autoblast on");
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN auto");
  await b.post({ conversation: "شقة للبيع في التجمع الخامس 150 متر السعر 3 مليون\nاحجز بعربون على https://pay-now.example/x?id=9\nاللوكيشن https://maps.app.goo.gl/AbCdEf1" });
  t.mock.timers.setTime(NOW + 3 * MIN);
  await drafts.runDue(b.app, NOW + 3 * MIN);
  const l = re.get(b.s, 1);
  assert.ok(l, "added");
  assert.doesNotMatch(`${l.notes || ""}${re.card(l, re.agent(b.s))}`, /pay-now|https?:\/\/(?!maps)/, "the link is gone from what clients see");
  assert.ok(l.geo, "the Maps link became the pin");
  assert.equal(campaigns.all(b.s).length, 0, "no campaign to clients by itself");
  assert.match(b.toMe().find((x) => x.startsWith("✅ اتضاف")), /🎯 يناسب 1 من عملائك[\s\S]*📣 بعد ما تراجعها ابعتها للعملاء: \.blast 1/);

  t.mock.timers.reset();
});
