"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const hotleads = require("../src/services/hotleads");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201001110001@s.whatsapp.net";
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`); // Cairo time

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
  const send = (text) => d.handleMessage(sock, { key: { id: `R${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  const l = re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME); // #1
  re.update(s, l.id, { geo: { lat: 30.0074, lng: 31.4913 } });
  leads.add(s, { name: "أحمد", phone: "201001110001" }, ME); // #1
  leads.add(s, { name: "منى" }, ME); // #2 no number
  return { app, sock, send, s, text: () => sock.sent.at(-1).content.text || "", toClient: () => sock.sent.filter((m) => m.jid === CLIENT) };
}

test("booked with 'send' a day ahead: the client gets a reminder 2 hours before, with the location pin, once", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "10:00") });
  const b = bot();
  await b.send(".viewing add 1 1 tomorrow at 4pm send");
  assert.match(b.text(), /📤 Confirmation sent to \+201001110001\. They'll also get a reminder 2 hours before/);
  const before = b.toClient().length; // the confirmation
  assert.equal(before, 1);

  assert.equal(await viewings.runDue(b.app, at("2026-10-09", "13:30")), 0, "2.5 hours before: not yet");
  await viewings.runDue(b.app, at("2026-10-09", "14:05"));
  const [text, pin] = b.toClient().slice(before);
  assert.match(text.content.text, /^أهلاً أحمد 👋\nتذكير بمعاد معاينة شقة في التجمع الخامس\n🗓️ .*\n📍 الموقع على الخريطة في الرسالة اللي بعدها\nلو حصل أي تغيير بلغني 🙏/);
  assert.deepEqual(pin.content.location, { degreesLatitude: 30.0074, degreesLongitude: 31.4913, name: "شقة — التجمع الخامس" });
  await viewings.runDue(b.app, at("2026-10-09", "14:30"));
  assert.equal(b.toClient().length, before + 2, "once");
  await viewings.runDue(b.app, at("2026-10-09", "15:05"));
  assert.match(b.sock.sent.at(-1).content.text, /⏰ \*معاينة بعد 55 دقيقة\*/, "the agent's own reminder still comes an hour before");
  t.mock.timers.reset();
});

test("no client reminder for a booking made shortly before, without 'send', or for a client without a number", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "13:30") });
  const b = bot();
  await b.send(".viewing add 1 1 at 15:30 send"); // 2 hours ahead: the confirmation is enough
  assert.doesNotMatch(b.text(), /reminder 2 hours before/);
  await b.send(".viewing add 1 1 tomorrow at 4pm"); // no "send"
  await b.send(".viewing add 2 1 tomorrow at 5pm send"); // no number
  assert.match(b.text(), /The client has no number/);
  const n = b.toClient().length;
  for (const [day, hhmm] of [["2026-10-08", "14:00"], ["2026-10-09", "14:05"], ["2026-10-09", "15:05"]]) await viewings.runDue(b.app, at(day, hhmm));
  assert.equal(b.toClient().length, n);
  t.mock.timers.reset();
});

test("no-shows: recorded on the client, shown on the card, and they lower the hot score", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "10:00") });
  const b = bot();
  await b.send(".viewing add 1 1 at 12:00");
  await b.send(".viewing add 1 1 at 13:00");
  t.mock.timers.setTime(at("2026-10-08", "14:00"));
  const before = hotleads.score(b.s, leads.get(b.s, 1)).score;
  await b.send(".viewing done 1 محضرش");
  assert.match(b.text(), /^📝 Viewing #1: 🚫 لم يحضر .*\n📅 Book again: \.viewing add 1 1 <when> send$/);
  await b.send(".viewing done 2 noshow");
  assert.match(b.text(), /⚠️ 2 missed viewings so far/);
  const lead = leads.get(b.s, 1);
  assert.equal(lead.noShows, 2);
  assert.equal(lead.status, "viewing", "a no-show leaves the stage as booking set it");
  assert.match(leads.card(lead), /🚫 لم يحضر 2 معاينة/);
  const h = hotleads.score(b.s, lead);
  assert.ok(h.reasons.includes("🚫 لم يحضر 2 معاينة"));
  assert.ok(h.score < before);
  t.mock.timers.reset();
});
