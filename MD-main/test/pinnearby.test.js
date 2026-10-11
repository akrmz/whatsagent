"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const sellers = require("../src/services/sellers");
const places = require("../src/services/places");
const { placeIn } = require("../src/listeners/pinnearby");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const NOW = Date.parse("2026-10-12T12:00:00Z");
// New Cairo, around the 5th Settlement.
const HERE = { lat: 30.0074, lng: 31.4913 };

function bot(t) {
  let now = NOW;
  t.mock.timers.enable({ apis: ["Date"], now });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = {
    list: [...copies.values()],
    byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])),
    disabled: loaded.disabled,
  };
  const app = makeApp({
    env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" },
    commands,
    listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }),
  });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  const s = app.state;
  const add = (f, geo) =>
    re.update(s, re.add(s, { deal: "بيع", ...f }, ME).id, geo ? { geo } : {});
  add(
    { type: "شقة", location: "التجمع الخامس", price: 4e6, size: 150 },
    { lat: 30.0131, lng: 31.4989 },
  ); // #1, ~1 km
  add(
    { type: "فيلا", location: "مدينتي", price: 18e6, size: 400 },
    { lat: 30.0967, lng: 31.6386 },
  ); // #2, ~17 km
  add(
    { type: "شاليه", location: "العين السخنة", price: 6e6, size: 110 },
    { lat: 29.5839, lng: 32.3245 },
  ); // #3, ~90 km: too far
  add(
    { type: "شقة", location: "التجمع الخامس", price: 3e6, size: 120 },
    { lat: 30.008, lng: 31.492 },
  ); // #4, closest, but sold
  re.update(s, 4, { status: "sold" });
  add({ type: "شقة", location: "التجمع", price: 2e6 }); // #5, no pin
  let n = 0;
  const raw = (message, from = CLIENT) =>
    d.handleMessage(sock, {
      key: { id: `L${++n}`, remoteJid: from, fromMe: false },
      pushName: "منى",
      message,
    });
  const pin = (p = HERE, from = CLIENT, extra = {}) =>
    raw(
      {
        locationMessage: {
          degreesLatitude: p.lat,
          degreesLongitude: p.lng,
          name: "بيتي",
          ...extra,
        },
      },
      from,
    );
  const later = (ms = 60000) => t.mock.timers.setTime((now += ms));
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s, pin, raw, later, to };
}

test("a client's pin gets the nearest available units, closest first, within 50 km", async (t) => {
  const b = bot(t);
  await b.pin();
  const msgs = b.to(CLIENT);
  assert.equal(msgs.length, 1);
  const text = msgs[0].content.text;
  assert.match(text, /^🗺️ \*أقرب وحداتنا المتاحة للموقع ده:\*/);
  assert.ok(text.indexOf("*#1*") < text.indexOf("*#2*"), "closest first");
  assert.match(text, /📍 \d+ م — \*#1\* شقة للبيع/, "under a km: in metres");
  assert.match(text, /📍 17 كم — \*#2\* فيلا للبيع/);
  assert.doesNotMatch(
    text,
    /#3\*|#4\*|#5\*/,
    "not too far, not sold, not without a pin",
  );
  assert.match(text, /ابعت رقم الوحدة زي \*#1\*/);
  t.mock.timers.reset();
});

test("nothing near: silence; flood: one answer per 30 seconds, 5 per 10 minutes", async (t) => {
  const b = bot(t);
  await b.pin({ lat: 31.2, lng: 29.9 }); // Alexandria
  assert.equal(b.to(CLIENT).length, 0);
  b.later();
  await b.pin();
  await b.pin();
  assert.equal(
    b.to(CLIENT).length,
    1,
    "the same pin twice right away: one answer",
  );
  for (let i = 0; i < 4; i++) {
    b.later();
    await b.pin();
  }
  assert.equal(
    b.to(CLIENT).length,
    3,
    "the 5-in-10-minutes limit (the Alexandria pin counted too)",
  );
  t.mock.timers.reset();
});

test("not answered: the team, a pin sent as a reply, a client around a viewing, live location", async (t) => {
  const b = bot(t);
  await b.pin(HERE, ME);
  assert.equal(b.to(ME).length, 0, "the owner's pin");
  await b.raw({
    locationMessage: {
      degreesLatitude: HERE.lat,
      degreesLongitude: HERE.lng,
      contextInfo: {
        quotedMessage: { conversation: "معاينتك بكرة" },
        stanzaId: "Q1",
        participant: ME,
      },
    },
  });
  assert.equal(b.to(CLIENT).length, 0, "a reply: it answers something");
  await b.raw({
    liveLocationMessage: {
      degreesLatitude: HERE.lat,
      degreesLongitude: HERE.lng,
    },
  });
  assert.equal(b.to(CLIENT).length, 0, "live location");
  const lead = leads.add(b.s, { name: "منى", phone: "201099998888" }, ME);
  viewings.add(b.s, {
    lead: lead.id,
    listing: 1,
    at: NOW + 3 * 3600 * 1000,
    chat: ME,
    by: ME,
  });
  await b.pin();
  assert.equal(b.to(CLIENT).length, 0, "on viewing day it is where they are");
  t.mock.timers.reset();
});

test("with autoleads, the client's card notes the units sent, without the coordinates", async (t) => {
  const b = bot(t);
  re.setAgent(b.s, "autoleads", "on");
  const lead = leads.add(b.s, { name: "منى", phone: "201099998888" }, ME);
  await b.pin();
  const notes = JSON.stringify(leads.get(b.s, lead.id));
  assert.match(notes, /بعت لوكيشن، وصلته أقرب الوحدات: #1 \(/);
  assert.doesNotMatch(notes, /30\.007|31\.491|بيتي/);
  t.mock.timers.reset();
});

test("a seller's pin goes to their open offer, and the listing made from it has the location", async (t) => {
  const b = bot(t);
  await b.raw({ conversation: ".agent sellers on" }, ME);
  await b.raw({ conversation: "عايز أبيع شقتي في التجمع الخامس 150 متر" });
  const before = b.to(CLIENT).length;
  await b.pin();
  assert.equal(b.to(CLIENT).at(-1).content.text, "📍 وصل الموقع، شكراً.");
  assert.equal(b.to(CLIENT).length, before + 1, "not the nearest units");
  const offer = sellers.list(b.s, "new")[0];
  assert.deepEqual(
    offer.fields.geo,
    HERE,
    "the point only, not the pin's name",
  );
  assert.match(sellers.summary(b.s, offer), /📍 معاه لوكيشن/);
  const l = sellers.toListing(b.s, b.app.config, offer.id, "", ME);
  assert.deepEqual(l.geo, HERE);
  t.mock.timers.reset();
});

test("a Google Maps link works like a pin: a full link is read, a short one opened; a sentence with a link isn't taken", async (t) => {
  const b = bot(t);
  const asked = [];
  places.setRequester(async (url) => {
    asked.push(url);
    return { status: 302, redirect: "https://www.google.com/maps/place/@30.0074,31.4913,17z" };
  });
  t.after(() => places.setRequester(null));
  await b.raw({ conversation: "قريب من هنا https://www.google.com/maps/place/@30.0074,31.4913,17z" });
  assert.match(b.to(CLIENT).at(-1).content.text, /^🗺️ \*أقرب وحداتنا المتاحة للموقع ده:\*\n\n📍 \d+ م — \*#1\*/);
  assert.equal(asked.length, 0, "a full link is read without opening it");
  b.later();
  await b.raw({ conversation: "https://maps.app.goo.gl/AbC123" });
  assert.equal(b.to(CLIENT).length, 2);
  assert.deepEqual(asked, ["https://maps.app.goo.gl/AbC123"]);

  const n = b.to(CLIENT).length;
  b.later();
  await b.raw({ conversation: "ده عنوان المكتب بتاعكم ولا انتو نقلتو؟ لأني رحت امبارح ومالقيتش حد هناك https://maps.app.goo.gl/AbC123" });
  await b.raw({ conversation: "#3 https://maps.app.goo.gl/AbC123" });
  assert.equal(b.to(CLIENT).length, n, "a sentence, or a listing code, with a link: something else");
  assert.equal(asked.length, 1, "and not opened");
  t.mock.timers.reset();
});

test("the link reader: what it takes, and that short links share one hourly budget", (t) => {
  const ctx = (body) => ({ body, content: {} });
  assert.deepEqual(placeIn(ctx("https://maps.app.goo.gl/AbC123")), { link: "https://maps.app.goo.gl/AbC123" });
  assert.equal(placeIn(ctx("مرحبا")), null);
  assert.equal(placeIn(ctx("https://example.com/maps")), null, "not a Maps link");
  const b = bot(t);
  for (let i = 0; i < 30; i++) places.expandBudget(b.s);
  assert.equal(places.expandBudget(b.s), false, "30 an hour for clients' and channels' links together");
  t.mock.timers.reset();
});
