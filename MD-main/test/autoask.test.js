"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const owners = require("../src/services/owners");
const ownerReport = require("../src/services/ownerreport");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const DAY = 86400 * 1000;
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);
const TODAY = at("2026-10-12", "10:00");
const phone = (n) => `2010000000${String(n).padStart(2, "0")}`;

function bot(t) {
  t.mock.timers.enable({ apis: ["Date"], now: TODAY - 60 * DAY });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  const s = app.state;
  const daysAgo = (n) => TODAY - n * DAY;
  const add = (n, days, extra = {}) => re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6, ...(n ? { owner: { name: `مالك ${n}`, phone: phone(n) } } : {}), ...extra }, ME, daysAgo(days)).id;
  add(1, 50); // #1: due
  add(1, 49); // #2: the same owner as #1: not the same day (and not while #1's question is open)
  add(3, 48); // #3: due
  const sold = add(4, 47); // #4: sold
  re.update(s, sold, { status: "sold" }, daysAgo(47));
  add(5, 10); // #5: updated 10 days ago
  const asked = add(6, 46); // #6: asked 10 days ago
  re.update(s, asked, { ask: { at: daysAgo(10), chat: ME, by: ME, to: phone(6), kind: "owner" } }, daysAgo(46));
  add(0, 45); // #7: nobody to ask
  add(8, 44); // #8: the owner said وقف التقارير
  ownerReport.setReports(s, phone(8), false);
  add(0, 43, { source: { kind: "channel", phones: [phone(9)], at: daysAgo(43) } }); // #9: the broker it came from
  add(10, 42); // #10
  add(11, 41); // #11
  add(12, 35); // #12: due, but the 6th: tomorrow
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `A${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  /** Runs the sending loop through a day, an hour at a time from 10:00. */
  const runDay = async (day) => {
    for (let h = 10; h < 21; h++) await campaigns.tick(app, at(day, `${h}:00`), () => 0);
  };
  const askedTo = () => sock.sent.filter((m) => /هل ما زال متاحاً|لسه متاح؟/.test(m.content.text || "")).map((m) => m.jid.split("@")[0]);
  return { app, s, sock, send, runDay, askedTo };
}

test("off by default; on: 5 a day, the quietest first, one per person, not sold, recent, asked, unreachable or opted out", async (t) => {
  const b = bot(t);
  await b.runDay("2026-10-12");
  assert.deepEqual(b.askedTo(), [], "off by default");
  await b.send(".agent autoask on");
  assert.equal(owners.autoTargets(b.s, TODAY).map((l) => l.id).join(","), "1,3,9,10,11");
  await b.runDay("2026-10-12");
  assert.deepEqual(b.askedTo(), [phone(1), phone(3), phone(9), phone(10), phone(11)]);
  assert.equal(re.get(b.s, 1).ask.auto, true);
  assert.equal(re.get(b.s, 1).ask.chat, ME, "the answers come to the owner's private chat");
  assert.match(b.sock.sent.find((m) => m.jid === `${phone(9)}@s.whatsapp.net`).content.text, /اللي كان معروض عندك \(#9\)/, "the broker is asked as a broker");
  assert.match(b.sock.sent.filter((m) => m.jid === ME).at(-1).content.text, /سؤال الملاك عن الإتاحة #\d+: ✅ 5 أُرسلت من 5/);

  // The next day: #12 (the 6th), not #2 (its owner still has #1's question open).
  await b.runDay("2026-10-13");
  assert.deepEqual(b.askedTo().slice(5), [phone(12)]);
  await b.runDay("2026-10-14");
  assert.equal(b.askedTo().length, 6, "nothing more: all asked in the last 30 days");
  t.mock.timers.reset();
});

test("the owner's answer comes to you; \"متاح\" counts as an update, so it isn't asked again for 30 days", async (t) => {
  const b = bot(t);
  await b.send(".agent autoask on");
  await b.runDay("2026-10-12");
  t.mock.timers.setTime(at("2026-10-12", "18:00"));
  await b.send("متاح", `${phone(3)}@s.whatsapp.net`);
  assert.match(b.sock.sent.filter((m) => m.jid === ME).at(-1).content.text, /✅ مالك 3 \(\+201000000003\) أكد إن #3 شقة — التجمع الخامس لسه متاح/);
  assert.equal(re.get(b.s, 3).updated, at("2026-10-12", "18:00"));
  assert.equal(owners.autoDue(b.s, re.get(b.s, 3), at("2026-11-11", "17:59")), false, "not quite 30 days");
  assert.equal(owners.autoDue(b.s, re.get(b.s, 3), at("2026-11-11", "18:00")), true, "30 days after the answer");
  t.mock.timers.reset();
});

test("a listing sold or confirmed after it was queued is skipped", async (t) => {
  const b = bot(t);
  await b.send(".agent autoask on");
  await campaigns.tick(b.app, at("2026-10-12", "10:00"), () => 0); // queued, #1 asked
  re.update(b.s, 3, { status: "sold" }, at("2026-10-12", "10:00"));
  await b.runDay("2026-10-12");
  assert.ok(!b.askedTo().includes(phone(3)));
  assert.equal(b.askedTo().length, 4);
  t.mock.timers.reset();
});
