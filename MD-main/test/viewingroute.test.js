"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const digest = require("../src/services/digest");
const route = require("../src/services/viewingroute");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const NOW = Date.parse("2026-10-10T06:00:00Z"); // Saturday 09:00 in Cairo
const at = (day, hhmm) => Date.parse(`2026-10-${day}T${hhmm}:00+03:00`);

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, chat = ME) => d.handleMessage(sock, { key: { id: `R${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? ME : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, s: app.state, send, text: () => sock.sent.at(-1).content.text || "" };
}

/** Tomorrow (Sunday 11 October): Zayed, then October (close, time enough), then New Cairo (far, no time), then a unit without a pin. */
function day(s) {
  const zayed = re.add(s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", geo: { lat: 30.0131, lng: 30.979 }, owner: { name: "أبو علي", phone: "201005550001" } }, ME).id;
  const october = re.add(s, { type: "شقة", deal: "بيع", location: "6 أكتوبر", geo: { lat: 29.9727, lng: 30.9386 } }, ME).id;
  const newCairo = re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", geo: { lat: 30.0074, lng: 31.4913 } }, ME).id;
  const noPin = re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي" }, ME).id;
  const mona = leads.add(s, { name: "منى", phone: "201001110001" }, ME).id;
  const ali = leads.add(s, { name: "علي", phone: "201001110002" }, ME).id;
  const add = (lead, listing, t) => viewings.add(s, { lead, listing, at: t, chat: ME, by: ME }, NOW);
  add(ali, newCairo, at(11, "13:30"));
  add(mona, zayed, at(11, "11:00"));
  add(mona, october, at(11, "12:30"));
  add(ali, noPin, at(11, "15:00"));
  add(ali, zayed, at(10, "18:00")); // today
  return { zayed, october, newCairo, noPin };
}

test(".viewings tomorrow: in order, the distance and drive between stops, a warning when it's too tight, one Maps link", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  day(b.s);
  await b.send(".viewings tomorrow");
  const r = b.text();
  assert.match(r, /^🗓️ \*معاينات بكرة\* — 2026-10-11 \(4\)/);
  assert.match(r, /🕐 \*11:00 ص\* — فيلا الشيخ زايد \(#1\)\n {3}👤 منى \+201001110001 \(#1\) · 🔑 المالك \+201005550001/, "the owner's number in the agent's own chat");
  assert.match(r, /\n {3}🚗 5\.9 كم · حوالي 15 دقيقة\n🕐 \*12:30 م\* — شقة 6 أكتوبر \(#2\)/);
  assert.match(r, /\n {3}⚠️ 53 كم \(حوالي 139 دقيقة سواقة\) وقدامك 0 دقيقة بس بعد المعاينة اللي قبلها\n🕐 \*1:30 م\* — شقة التجمع الخامس \(#3\)/);
  assert.match(r, /🕐 \*3:00 م\* — شاليه الساحل الشمالي \(#4\)/);
  assert.match(r, /🗺️ الطريق بالترتيب: https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=30\.0074%2C31\.4913&waypoints=30\.0131%2C30\.979%7C29\.9727%2C30\.9386&travelmode=driving/);
  assert.match(r, /📍 من غير لوكيشن: #4 — \.listing loc <رقم>/);
  assert.doesNotMatch(r, /18:00|6:00 م/, "not today's");

  await b.send(".viewings tomorrow", GROUP);
  assert.doesNotMatch(b.text(), /المالك/, "owners stay private outside the agent's own chat");
  await b.send(".viewings today");
  assert.match(b.text(), /^🗓️ \*معاينات النهارده\* — 2026-10-10 \(1\)/);
  assert.doesNotMatch(b.text(), /🚗|⚠️/, "a single viewing: no legs");
  t.mock.timers.setTime(at(13, "09:00"));
  await b.send(".viewings today");
  assert.match(b.text(), /^No viewings today \(2026-10-13\)/);
  t.mock.timers.reset();
});

test("the morning summary links the day's route and warns about a tight gap", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  day(b.s);
  const tomorrow = at(11, "08:00");
  const d = digest.build(b.s, "Africa/Cairo", tomorrow);
  assert.match(d, /🗺️ الطريق بالترتيب: https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=30\.0074/);
  assert.match(d, /⚠️ معاينة الوقت قبلها مش مكفي المشوار — \.viewings today/);
  assert.doesNotMatch(digest.build(b.s, "Africa/Cairo", NOW), /🗺️ الطريق/, "one viewing today: no route");
  t.mock.timers.reset();
});

test("route links: the same place once in a row, at most 10 stops; drive estimates", () => {
  const p = (i) => ({ lat: 30 + i / 100, lng: 31 });
  const url = route.routeUrl(Array.from({ length: 12 }, (_, i) => p(i)));
  assert.equal(decodeURIComponent(url.match(/waypoints=([^&]+)/)[1]).split("|").length, 9);
  assert.match(url, /destination=30\.09%2C31/, "the 10th stop is the destination");
  assert.equal(route.driveMinutes(10), 26);
  assert.equal(route.driveMinutes(0), 0);
});
