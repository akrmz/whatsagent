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
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`);

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
  const send = (text) => d.handleMessage(sock, { key: { id: `V${++n}`, remoteJid: ME, fromMe: false }, pushName: "Agent", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس، النرجس; بجوار النادي", price: 3.2e6 }, ME); // #1 (a comma and a semicolon, for the calendar file)
  leads.add(s, { name: "أحمد", phone: "201001110001" }, ME); // #1
  return { app, sock, send, s, last: () => sock.sent.at(-1).content, text: () => sock.sent.at(-1).content.text || "" };
}

test("after a viewing: asked how it went 2 hours later; 'done' records it and moves the client", async (t) => {
  const t0 = at("2026-10-08", "10:00");
  t.mock.timers.enable({ apis: ["Date"], now: t0 });
  const b = bot();
  await b.send(".viewing add 1 1 today at 16:00");
  const v = viewings.upcoming(b.s, t0)[0];
  await b.send(`.viewing done ${v.id} liked`);
  assert.match(b.text(), /hasn't happened yet/);

  assert.equal(await viewings.runDue(b.app, at("2026-10-08", "17:30")), 0, "1.5 hours after: not yet");
  assert.equal(await viewings.runDue(b.app, at("2026-10-08", "18:05")), 1);
  assert.match(b.text(), /^📝 \*كيف كانت المعاينة؟\*\n🗓️ \*#1\* .*\n\.viewing done 1 liked \| thinking \| no \[ملاحظة\]$/);
  assert.equal(await viewings.runDue(b.app, at("2026-10-08", "19:00")), 0, "asked once");

  t.mock.timers.setTime(at("2026-10-08", "19:00"));
  await b.send(`.viewing done ${v.id} عجبه عايز يتفاوض على السعر`);
  assert.match(b.text(), /^📝 Viewing #1: 👍 أعجبه — عايز يتفاوض على السعر \(أحمد #1, #1\)\n🤝 #1 moved to negotiating/);
  const c = leads.get(b.s, 1);
  assert.equal(c.status, "negotiating");
  assert.match(c.history.at(-1).text, /^نتيجة معاينة #1: 👍 أعجبه — عايز يتفاوض على السعر$/);
  await b.send(".viewings");
  assert.match(b.text(), /🗓️ \*#1\* .* — 👍 أعجبه/);
  await b.send(`.viewing done ${v.id} maybe`);
  assert.equal(leads.get(b.s, 1).status, "negotiating", "'thinking' later doesn't move a client back");
  await b.send(".viewing done 1 رائع");
  assert.match(b.text(), /Usage: \.viewing done <viewing> liked \| thinking \| no/);
  t.mock.timers.reset();
});

test("without an outcome a viewing is kept 7 days and listed in the morning summary; with one, a day", async (t) => {
  const t0 = at("2026-10-08", "10:00");
  t.mock.timers.enable({ apis: ["Date"], now: t0 });
  const b = bot();
  await b.send(".viewing add 1 1 today at 16:00"); // #1: no outcome
  await b.send(".viewing add 1 1 today at 17:00"); // #2: recorded
  t.mock.timers.setTime(at("2026-10-08", "20:00"));
  await b.send(".viewing done 2 no السعر عالي");
  assert.match(leads.get(b.s, 1).history.at(-1).text, /👎 لم يعجبه — السعر عالي/);

  const morning = digest.build(b.s, "Africa/Cairo", at("2026-10-09", "08:30"));
  assert.match(morning, /📝 بدون نتيجة: #1 — \.viewing done <رقم> liked\|thinking\|no/);
  await viewings.runDue(b.app, at("2026-10-09", "18:00"));
  assert.deepEqual(Object.keys(b.s.store("viewings").data.items), ["1"], "the recorded one is dropped a day after");
  await viewings.runDue(b.app, at("2026-10-14", "12:00"));
  assert.ok(viewings.get(b.s, 1), "6 days on, it can still be recorded");
  await viewings.runDue(b.app, at("2026-10-15", "17:00"));
  assert.equal(viewings.get(b.s, 1), null, "dropped after 7 days");
  t.mock.timers.reset();
});

test(".viewings ics: a valid calendar file with the upcoming viewings and an alarm", async (t) => {
  const t0 = at("2026-10-08", "10:00");
  t.mock.timers.enable({ apis: ["Date"], now: t0 });
  const b = bot();
  await b.send(".viewings ics");
  assert.match(b.text(), /No upcoming viewings to export/);
  await b.send(".viewing add 1 1 tomorrow at 4pm");
  await b.send(".viewing add 1 1 friday at 18:00");
  await b.send(".viewings ics");
  const doc = b.last();
  assert.equal(doc.mimetype, "text/calendar");
  assert.equal(doc.fileName, "viewings.ics");
  assert.match(doc.caption, /^🗓️ 2 viewing\(s\)/);
  const raw = doc.document.toString("utf8");
  assert.ok(raw.endsWith("\r\n") && !/[^\r]\n/.test(raw), "CRLF line endings only");
  for (const l of raw.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, `folded: ${l}`);
  const text = raw.replace(/\r\n /g, ""); // unfold
  assert.equal(Buffer.from(text, "utf8").toString("utf8"), text, "folding never splits a character");
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(text, /\r\nDTSTART:20261009T130000Z\r\nDTEND:20261009T140000Z\r\n/, "16:00 Cairo time is 13:00 UTC");
  assert.match(text, /SUMMARY:معاينة: شقة التجمع الخامس، النرجس\\; بجوار النادي \(#1\) — أحمد/, "';' escaped");
  assert.match(text, /DESCRIPTION:\+201001110001 · 3\\,200\\,000 · #1/, "',' escaped");
  assert.match(text, /BEGIN:VALARM\r\nTRIGGER:-PT60M\r\nACTION:DISPLAY/);
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(text, /END:VCALENDAR\r\n$/);
  assert.equal(viewings.fold("x".repeat(160)).split("\r\n ").map((p) => p.length).join(","), "75,74,11");
  t.mock.timers.reset();
});
