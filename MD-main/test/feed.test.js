"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const feed = require("../src/services/feed");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const BROKER = "201055554444@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const OTHER = "120363000000000010@g.us";
const DAY = 86400 * 1000;

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
  const send = (text, { from = ME, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `F${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: from === BROKER ? "Hassan" : "Agent", message: { conversation: text } });
  const toOwner = () => sock.sent.filter((m) => m.jid === ME);
  return { app, sock, send, s: app.state, toOwner, text: () => sock.sent.at(-1).content.text || "" };
}

const OFFER = "للبيع شقة في التجمع الخامس 150 متر 3 غرف بسعر 3.2 مليون كاش";
const REQUEST = "مطلوب شقة في التجمع 3 غرف حدود 3 مليون";

test("classifying brokers' posts: offers, requests, and chatter", () => {
  assert.deepEqual(feed.classify(OFFER), { kind: "offer", fields: { type: "شقة", deal: "بيع", size: 150, rooms: 3, price: 3.2e6, location: "التجمع الخامس" } });
  assert.deepEqual(feed.classify(REQUEST), { kind: "request", fields: { type: "شقة", location: "التجمع", rooms: 3, max: 3e6 } });
  assert.equal(feed.classify("فيه شقة للبيع في التجمع 150 متر بسعر 3 مليون").kind, "offer", "an offer, not a request");
  assert.equal(feed.classify("صباح الخير يا جماعة"), null);
  assert.equal(feed.classify("شقة حلوة جداً في التجمع"), null, "no price: not an offer");
  assert.equal(feed.hashOf("🔥 للبيع شقة،  في التجمع!!"), feed.hashOf("للبيع شقة في التجمع"), "reposts with other emoji and spacing are the same post");
});

test(".watch on: offers suiting clients and requests matching listings alert the owner; nothing is posted in the group", async () => {
  const b = bot();
  leads.add(b.s, { name: "أحمد", phone: "201001110001", type: "شقة", location: "التجمع", max: 3.5e6 }, ME);
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 2.9e6, rooms: 3 }, ME); // #1

  await b.send(OFFER, { from: BROKER, chat: GROUP });
  assert.equal(feed.all(b.s).length, 0, "not watched yet");

  await b.send(".watch on", { chat: GROUP });
  assert.match(b.text(), /Watching this group/);
  assert.equal(feed.watched(b.s, GROUP).name, "Test group");
  const inGroup = () => b.sock.sent.filter((m) => m.jid === GROUP).length;
  const before = inGroup();

  await b.send(OFFER, { from: BROKER, chat: GROUP });
  let alert = b.toOwner().at(-1).content.text;
  assert.match(alert, /^🔔 عرض في "Test group" يناسب 1 من عملائك: #1 أحمد\n\*#F1\* شقة للبيع — التجمع الخامس — 3\.2 مليون جنيه · 150م² · 3 غرف\n👤 السمسار: Hassan \+201055554444\n\.feed 1$/);

  await b.send(REQUEST, { from: BROKER, chat: GROUP });
  alert = b.toOwner().at(-1).content.text;
  assert.match(alert, /^🔔 طلب في "Test group": شقة، في التجمع، 3 غرف، حتى 3 مليون جنيه\n🏠 عندك 1 مناسب: #1\n/);

  const alerts = b.toOwner().length;
  await b.send(`🔥🔥 ${OFFER} !!`, { from: BROKER, chat: GROUP });
  assert.equal(feed.all(b.s).length, 2, "a repost isn't saved again");
  assert.equal(b.toOwner().length, alerts, "nor alerted again");
  await b.send("للبيع فيلا في الشيخ زايد 400 متر بسعر 12 مليون", { from: BROKER, chat: GROUP });
  assert.equal(feed.all(b.s).length, 3);
  assert.equal(b.toOwner().length, alerts, "saved, but no alert: it suits nobody");
  await b.send(OFFER.replace("3.2", "3.1"), { chat: GROUP });
  assert.equal(feed.all(b.s).length, 3, "the owner's own posts aren't brokers' posts");
  await b.send(OFFER.replace("3.2", "3.3"), { from: BROKER, chat: OTHER });
  assert.equal(feed.all(b.s).length, 3, "other groups aren't watched");
  assert.equal(inGroup(), before, "the bot never posts in the group");

  await b.send(".watch off", { chat: GROUP });
  await b.send(OFFER.replace("3.2", "3.4"), { from: BROKER, chat: GROUP });
  assert.equal(feed.all(b.s).length, 3);
});

test(".feed: search offers, requests, one post, and add an offer to the catalogue", async () => {
  const b = bot();
  leads.add(b.s, { name: "أحمد", phone: "201001110001", type: "شقة", location: "التجمع", max: 3.5e6 }, ME);
  await b.send(".watch on", { chat: GROUP });
  await b.send(OFFER, { from: BROKER, chat: GROUP }); // F1
  await b.send("للبيع فيلا في الشيخ زايد 400 متر بسعر 12 مليون", { from: BROKER, chat: GROUP }); // F2
  await b.send(REQUEST, { from: BROKER, chat: GROUP }); // F3

  await b.send(".feed");
  assert.match(b.text(), /🏷️ \*عروض السماسرة\* \(2\)/);
  assert.match(b.text(), /\*#F1\* شقة للبيع — التجمع الخامس .* · 🎯 1/);
  await b.send(".feed فيلا زايد");
  assert.match(b.text(), /\(1\)\n\n\*#F2\* فيلا/);
  await b.send(".feed requests");
  assert.match(b.text(), /🔎 \*طلبات السماسرة\* \(1\)\n\n\*F3\* شقة، في التجمع، 3 غرف، حتى 3 مليون جنيه/);
  await b.send(".feed 1");
  assert.match(b.text(), /^🏷️ \*عرض\* F1 — "Test group" — الآن\n👤 Hassan \(\+201055554444\)\n\nللبيع شقة في التجمع الخامس/);
  assert.match(b.text(), /🎯 يناسب: #1 أحمد/);

  await b.send(".feed add 1");
  assert.match(b.text(), /✅ Added as \*#1\* \(shared with the broker/);
  const l = re.get(b.s, 1);
  assert.equal(l.price, 3.2e6);
  assert.match(l.notes, /مشاركة مع السمسار Hassan \+201055554444 \(F1\)/);
  await b.send(".feed add 3");
  assert.match(b.text(), /Which offer\?/, "a request can't be added as a listing");
  await b.send(".feed groups");
  assert.match(b.text(), /▫️ Test group/);
  await b.send(".feed", { from: BROKER });
  assert.doesNotMatch(b.text(), /عروض السماسرة/, "owner and sudo only");
});

test("the feed keeps 30 days, ignores reposts for a week, and alerts at most 20 times an hour", () => {
  const b = bot();
  const t0 = Date.parse("2026-10-01T10:00:00Z");
  const post = (text, at) => feed.save(b.s, { ...feed.classify(text), chat: GROUP, poster: "201055554444", name: "Hassan", text }, at);
  assert.ok(post(OFFER, t0));
  assert.equal(post(OFFER, t0 + 6 * DAY), null, "a repost within a week");
  assert.ok(post(OFFER, t0 + 8 * DAY), "after a week it's new again");
  post(OFFER.replace("3.2", "3.5"), t0 + 31 * DAY);
  assert.deepEqual(feed.all(b.s).map((i) => i.at), [t0 + 31 * DAY, t0 + 8 * DAY], "older than 30 days is pruned");
  let ok = 0;
  for (let i = 0; i < 25; i++) if (feed.alertBudget(b.s)) ok++;
  assert.equal(ok, 20);
});
