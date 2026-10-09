"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const health = require("../src/services/listinghealth");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const at = (day) => Date.parse(`${day}T09:00:00+03:00`);

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `H${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "" };
}

test(".listings check: what each available listing misses, the most incomplete first, with the fix", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-08-01") });
  const b = bot();
  const geo = { lat: 31.0, lng: 28.5 };
  const owner = { name: "أبو أحمد", phone: "201001234567" };
  re.add(b.s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 8e6, size: 120, rooms: 2, geo, owner }, ME); // #1: complete…
  re.update(b.s, 1, { photos: 3 });
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع" }, ME); // #2: no photos, price, size, rooms, pin, owner
  re.add(b.s, { type: "محل", deal: "بيع", location: "وسط البلد", price: 2e6, size: 40, geo, owner }, ME); // #3: no photos (a shop needs no rooms)
  re.update(b.s, 3, { photos: 0 });
  re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6, size: 300, rooms: 4, geo, owner }, ME); // #4
  re.update(b.s, 4, { status: "sold" }); // sold: not checked
  t.mock.timers.setTime(at("2026-09-15")); // #1 … but 45 days old now
  re.update(b.s, 3, { photos: 0 });

  const { list, total } = health.check(b.s);
  assert.equal(total, 3);
  assert.deepEqual(list.map(({ listing, gaps }) => [listing.id, gaps.map((g) => g.key)]), [
    [2, ["photos", "price", "size", "rooms", "geo", "owner", "stale"]],
    [3, ["photos"]],
    [1, ["stale"]],
  ]);
  assert.equal(list[2].gaps[0].fix, ".listing ask 1", "an old listing with an owner: ask them");

  await b.send(".listings check");
  const r = b.last();
  assert.match(r, /^🧹 \*Listings to complete\* \(3 of 3 available\)/);
  assert.match(r, /#2[^\n]*\n {3}ناقص: 📷 صور · 💰 السعر · 📐 المساحة · 🛏 الغرف · 🗺️ اللوكيشن · 🔑 رقم المالك · 🕸️ من 45 يوم\n {3}↳ \.listing photo 2 \(على صورة\)/);
  assert.match(r, /#1[^\n]*\n {3}ناقص: 🕸️ من 45 يوم\n {3}↳ \.listing ask 1/);
  await b.send(".listings check", CLIENT);
  assert.match(b.last(CLIENT), /^Only the owner and sudo users check the catalogue/);

  re.update(b.s, 1, {}, Date.now()); // touched today
  re.update(b.s, 2, { status: "sold" });
  re.update(b.s, 3, { photos: 1 });
  await b.send(".listings check");
  assert.match(b.last(), /^✅ All 2 available listing\(s\) have photos/);
  t.mock.timers.reset();
});

test("the Saturday morning summary says how many listings miss photos, a price, a size or an area", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-10") }); // a Saturday
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع" }, ME);
  re.add(b.s, { type: "شقة", deal: "بيع", price: 3e6, size: 150 }, ME);
  assert.match(digest.build(b.s, "Africa/Cairo", at("2026-10-10")), /🧹 عقارات ناقصها بيانات: 📷 صور 2 · 💰 سعر 1 · 📐 مساحة 1 · 📍 منطقة 1 — \.listings check/);
  assert.doesNotMatch(digest.build(b.s, "Africa/Cairo", at("2026-10-11")), /🧹/, "only on Saturdays");
  t.mock.timers.reset();
});
