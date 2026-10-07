"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const places = require("../src/services/places");
const re = require("../src/services/realestate");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const TOWER = { lat: 30.045915, lng: 31.224289 };
const pin = (lat, lng, name) => ({ locationMessage: { degreesLatitude: lat, degreesLongitude: lng, ...(name ? { name } : {}) } });

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
  const send = (text, { from = ME, quoted } = {}) =>
    d.handleMessage(sock, {
      key: { id: `P${++n}`, remoteJid: from, fromMe: false },
      pushName: "Mona",
      message: quoted ? { extendedTextMessage: { text, contextInfo: { quotedMessage: quoted, participant: from, stanzaId: "Q" } } } : { conversation: text },
    });
  const last = () => sock.sent.at(-1).content;
  return { app, sock, send, last, text: () => last().text || last().caption || "" };
}

/** A fake HTTP client: each URL redirects to the next one in `hops`. */
function redirects(hops) {
  const asked = [];
  places.setRequester(async (url) => {
    asked.push(url);
    if (url === "THROW") throw new Error("offline");
    return { status: 302, url, redirect: hops[url] || null };
  });
  return asked;
}

test("coordinates from Maps links, plain text and location messages; bad ones are refused", () => {
  // A place link: the place's own "!3d…!4d…" wins over the map centre "@…".
  assert.deepEqual(places.fromText("https://www.google.com/maps/place/X/@30.1,31.2,17z/data=!3d30.045915!4d31.224289"), TOWER);
  assert.deepEqual(places.fromText("https://maps.google.com/?q=30.045915,31.224289"), TOWER);
  assert.deepEqual(places.fromText("https://www.google.com/maps/search/?api=1&query=30.045915%2C31.224289"), TOWER);
  assert.deepEqual(places.fromText("https://www.google.com/maps/@30.045915,31.224289,15z"), TOWER);
  assert.deepEqual(places.fromText("الموقع ٣٠٫٠٤٥٩١٥, ٣١٫٢٢٤٢٨٩"), TOWER);
  assert.deepEqual(places.fromText("30.045915, 31.224289"), TOWER);
  assert.equal(places.fromText("call 0100 123 4567"), null, "a phone number is not a place");
  assert.equal(places.fromText("0.0000, 0.0000"), null, "0,0 is an empty GPS fix");
  assert.equal(places.fromText("95.1234, 31.2242"), null, "latitude over 90");
  assert.deepEqual(places.fromMessage(pin(30.045915, 31.224289, "برج القاهرة")), { ...TOWER, label: "برج القاهرة" });
  assert.equal(places.fromMessage({ conversation: "hi" }), null);
  // Google Maps links are recognised in posts (only short links are ever opened; see below).
  assert.ok(places.MAP_LINK.test("https://google.com.eg/maps?q=30.05,31.23"));
  for (const other of ["https://evil.com/google.com/maps", "https://notgoogle.com/maps"]) assert.ok(!places.MAP_LINK.test(other), other);
  assert.equal(places.km(places.distanceKm({ lat: 30.0444, lng: 31.2357 }, { lat: 31.2001, lng: 29.9187 })), "180 كم");
  assert.equal(places.km(0.45), "450 م");
  assert.equal(places.km(3.21), "3.2 كم");
});

test("short Maps links are expanded through their redirects, only to Google over https, at most 4 hops", async (t) => {
  t.after(() => places.setRequester(null));
  const short = "https://maps.app.goo.gl/AbC123";
  redirects({ [short]: "https://www.google.com/maps/place/Cairo+Tower/data=!3d30.045915!4d31.224289" });
  assert.deepEqual(await places.fromTextOrLink(`شوف ده ${short}`), TOWER);

  // Through Google's consent page and back.
  redirects({ [short]: "https://consent.google.com/m?continue=x", "https://consent.google.com/m?continue=x": "https://www.google.com/maps?q=30.045915,31.224289" });
  assert.deepEqual(await places.expandShort(short), TOWER);

  let asked = redirects({ [short]: "https://evil.example/next", "https://evil.example/next": "https://www.google.com/maps?q=30.045915,31.224289" });
  assert.equal(await places.expandShort(short), null, "a redirect away from Google is not followed");
  assert.deepEqual(asked, [short]);

  asked = redirects({ [short]: "http://www.google.com/maps/x" });
  assert.equal(await places.expandShort(short), null, "plain http is not followed");
  assert.deepEqual(asked, [short]);

  const loop = {};
  for (let i = 0; i < 10; i++) loop[i ? `https://www.google.com/x${i}` : short] = `https://www.google.com/x${i + 1}`;
  asked = redirects(loop);
  assert.equal(await places.expandShort(short), null);
  assert.equal(asked.length, 4, "4 hops at most");

  redirects({});
  assert.equal(await places.expandShort("THROW"), null, "a network error is just 'not found'");
});

test("a Maps link in a post becomes the listing's location without confusing the price; the card links the map", async () => {
  const b = bot();
  await b.send(".listing add\nشقة للبيع في التجمع الخامس 150 متر 3 غرف بسعر 3.5 مليون\nاللوكيشن: https://www.google.com/maps/place/X/@30.1,31.2,17z/data=!3d30.007412!4d31.491322");
  const l = re.get(b.app.state, 1);
  assert.deepEqual(l.geo, { lat: 30.007412, lng: 31.491322 });
  assert.equal(l.price, 3500000);
  assert.equal(l.size, 150);
  assert.equal(l.notes.includes("اللوكيشن"), false, "the label of the link doesn't become a note");
  assert.match(b.text(), /🗺️ الموقع على الخريطة: https:\/\/maps\.google\.com\/\?q=30\.007412,31\.491322/);

  // The export keeps it, and importing the export reads it back.
  const row = re.parseListingText("type: شقة\nmap: https://maps.google.com/?q=30.007412,31.491322");
  assert.deepEqual(row, { type: "شقة", geo: { lat: 30.007412, lng: 31.491322 } });
});

test("a short link in a post is expanded by .listing add; .listing edit can add one", async (t) => {
  t.after(() => places.setRequester(null));
  const b = bot();
  redirects({ "https://maps.app.goo.gl/Zayed1": "https://www.google.com/maps?q=30.039200,30.983900" });
  await b.send(".listing add فيلا للبيع في الشيخ زايد بسعر 9 مليون https://maps.app.goo.gl/Zayed1");
  assert.deepEqual(re.get(b.app.state, 1).geo, { lat: 30.0392, lng: 30.9839 });
  await b.send(".listing add شقة للإيجار في المعادي بسعر 15 ألف");
  await b.send(".listing edit 2 https://maps.google.com/?q=29.960300,31.256900");
  assert.deepEqual(re.get(b.app.state, 2).geo, { lat: 29.9603, lng: 31.2569 });
  assert.equal(re.get(b.app.state, 2).price, 15000, "the edit changed only the location");
});

test(".listing loc saves a pin, coordinates or a link; .listing 12 map sends the pin; del removes it; clients can't set it", async () => {
  const b = bot();
  await b.send(".listing add شقة للبيع في التجمع بسعر 3 مليون");
  await b.send(".listing loc 1", { quoted: pin(30.007412, 31.491322, "كمبوند النرجس") });
  assert.deepEqual(re.get(b.app.state, 1).geo, { lat: 30.007412, lng: 31.491322, label: "كمبوند النرجس" });
  assert.match(b.text(), /📍 Location saved for #1 \(كمبوند النرجس\)/);

  await b.send(".listing 1 map", { from: CLIENT });
  assert.deepEqual(b.last().location, { degreesLatitude: 30.007412, degreesLongitude: 31.491322, name: "#1 شقة — التجمع" });
  await b.send(".listing map 1", { from: CLIENT });
  assert.equal(b.last().location.degreesLatitude, 30.007412);

  await b.send(".listing loc 1 30.0100, 31.5000");
  assert.deepEqual(re.get(b.app.state, 1).geo, { lat: 30.01, lng: 31.5 });
  await b.send(".listing loc 1 nothing here");
  assert.match(b.text(), /Reply to a location pin/);
  assert.deepEqual(re.get(b.app.state, 1).geo, { lat: 30.01, lng: 31.5 }, "unchanged");

  await b.send(".listing loc 1 30.2, 31.2", { from: CLIENT });
  assert.match(b.text(), /Only the owner and sudo users manage listings/);
  await b.send(".listing loc 1 del");
  assert.equal(re.get(b.app.state, 1).geo, null);
  await b.send(".listing 1 map", { from: CLIENT });
  assert.match(b.text(), /#1 has no location saved yet\.$/, "clients aren't told how to set it");
});

test(".listings near: replying to a client's pin lists the closest listings with distances, filters and a radius", async () => {
  const b = bot();
  const s = b.app.state;
  const at = (l, lat, lng) => re.update(s, l.id, { geo: { lat, lng } });
  at(re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME), 30.007412, 31.491322); // #1
  at(re.add(s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", price: 9e6 }, ME), 30.0392, 30.9839); // #2
  at(re.add(s, { type: "شقة", deal: "بيع", location: "مدينتي", price: 4e6 }, ME), 30.0890, 31.6370); // #3
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2e6 }, ME); // #4, no location
  const sold = re.add(s, { type: "شقة", deal: "بيع", location: "الرحاب", price: 3e6 }, ME); // #5, sold
  at(sold, 30.06, 31.49);
  re.update(s, sold.id, { status: "sold" });

  const client = pin(30.0200, 31.4700, "موقع العميل");
  await b.send(".listings near", { quoted: client });
  const r = b.text();
  assert.match(r, /🗺️ \*الأقرب إلى موقع العميل\* \(3\)/);
  const order = [...r.matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 3, 2], "nearest first; sold and unplaced listings left out");
  assert.match(r, /📍 2\.5 كم — \*#1\* شقة للبيع — التجمع الخامس/);
  assert.match(r, /\(1 matching listing\(s\) have no saved location/, "staff are told what's missing");

  await b.send(".listings near شقة 20 كم", { quoted: client });
  assert.deepEqual([...b.text().matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1])), [1, 3]);
  assert.match(b.text(), /\(2 ضمن 20 كم\)/);

  await b.send(".listings", { from: CLIENT, quoted: client }); // a reply to a pin means "near"
  assert.match(b.text(), /الأقرب/);
  assert.doesNotMatch(b.text(), /no saved location/, "clients don't see the staff note");

  await b.send(".listings near 30.0200, 31.4700 فيلا");
  assert.deepEqual([...b.text().matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1])), [2]);
  await b.send(".listings near 2 كم", { quoted: client });
  assert.match(b.text(), /No available listing within 2 km matches/);
  await b.send(".listings near");
  assert.match(b.text(), /Reply to a location pin/);
});

test("short links sent by clients are opened at most 30 times an hour", async (t) => {
  t.after(() => places.setRequester(null));
  const b = bot();
  const asked = redirects({});
  // Several clients (one client alone hits the general per-user command limit first).
  for (let i = 0; i < 32; i++) await b.send(`.listings near https://maps.app.goo.gl/x${i}`, { from: `2010999900${String(i % 4).padStart(2, "0")}@s.whatsapp.net` });
  assert.equal(asked.length, 30);
  await b.send(".listings near https://maps.app.goo.gl/staff");
  assert.equal(asked.length, 31, "the owner isn't limited");
});
