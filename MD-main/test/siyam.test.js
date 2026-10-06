"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const siyam = require("../src/services/siyam");
const khatma = require("../src/services/khatma");
const { stopAll } = require("../src/services/automations");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const A = "447911123456@s.whatsapp.net";
const B = "447911654321@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000003@g.us";
const ZONE = "Africa/Cairo";
const cairo = (iso) => Date.parse(`${iso}+03:00`); // Cairo summer time until the end of October 2026
const noon = (d) => new Date(`${d}T12:00:00Z`);

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: ZONE }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: A }, { id: B }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

// Hijri dates below were checked against aladhan.com's Umm al-Qura conversion (gToH, calendarMethod=UAQ).
test("sunnah fasting days by the Umm al-Qura calendar", () => {
  const reasons = (d, o) => siyam.fastsOn(noon(d), ZONE, o).reasons.join(" | ");
  assert.equal(reasons("2026-10-08"), "صيام يوم الخميس");
  assert.equal(reasons("2026-10-07"), "", "a Wednesday, 26 Rabi' al-Akhir");
  assert.match(reasons("2026-10-24"), /^أول الأيام البيض \(١٣ جمادى الأولى\)$/);
  assert.match(reasons("2026-10-26"), /آخر الأيام البيض .* \| صيام يوم الاثنين/);
  assert.equal(reasons("2026-10-26", { weekly: false }), "آخر الأيام البيض (١٥ جمادى الأولى)");
  assert.equal(reasons("2027-05-15"), "🕋 يوم عرفة");
  assert.match(reasons("2027-06-14"), /تاسوعاء/);
  assert.equal(reasons("2027-06-15"), "يوم عاشوراء");
  assert.equal(reasons("2027-03-10"), "بداية صيام الست من شوال");

  for (const d of ["2027-03-09", "2027-05-16", "2027-05-17", "2027-05-18", "2027-05-19"]) {
    const f = siyam.fastsOn(noon(d), ZONE);
    assert.equal(f.forbidden, true, `${d}: Eid or Tashreeq`);
    assert.deepEqual(f.reasons, [], `${d}: never suggested, even on a Monday/Thursday or the 13th`);
  }
  const ramadan = siyam.fastsOn(noon("2027-02-15"), ZONE);
  assert.equal(ramadan.ramadan, true);
  assert.deepEqual(ramadan.reasons, [], "no sunnah reminders in Ramadan");
});

test("evening reminder: the day before, once, only when tomorrow is a sunnah fast", async () => {
  assert.equal(siyam.reminderFor(cairo("2026-10-06T20:00:00"), ZONE), null, "Wednesday tomorrow");
  const text = siyam.reminderFor(cairo("2026-10-23T20:00:00"), ZONE);
  assert.match(text, /غداً السبت ١٣ جمادى الأولى/);
  assert.match(text, /أول الأيام البيض/);
  assert.equal(siyam.reminderFor(cairo("2026-10-11T20:00:00"), ZONE, { weekly: false }), null, "Monday only, weekly off");

  const t = realBot();
  siyam.set(t.app.state, GROUP, {});
  assert.equal(await siyam.runDue(t.app, cairo("2026-10-11T19:59:00")), 0, "before 20:00");
  assert.equal(await siyam.runDue(t.app, cairo("2026-10-11T20:00:00")), 1);
  assert.match(t.last(), /غداً الاثنين/);
  assert.equal(await siyam.runDue(t.app, cairo("2026-10-11T20:05:00")), 0, "once a day");
  assert.equal(await siyam.runDue(t.app, cairo("2026-10-13T20:01:00")), 0, "Wednesday tomorrow: nothing sent");
  assert.equal(siyam.get(t.app.state, GROUP).last, "2026-10-13", "but the day is marked done");
  assert.equal(await siyam.runDue(t.app, cairo("2026-10-14T23:30:00")), 0, "more than 3 h late");
});

test(".siyam and .autosiyam from chat", async () => {
  const t = realBot();
  await t.send({ text: ".siyam", chat: GROUP, sender: A });
  assert.match(t.last(), /أيام صيام السنة في الأيام الـ٣٠ القادمة/);
  assert.match(t.last(), /يوم عرفة: \d{4}-\d\d-\d\d/);
  assert.match(t.last(), /يوم عاشوراء: /);
  assert.doesNotMatch(t.last(), /تاسوعاء \(/, "Tasu'a is not listed as a separate special day");
  await t.send({ text: ".siyam 500", chat: GROUP, sender: A });
  assert.match(t.last(), /7-60/);
  await t.send({ text: ".autosiyam on 9pm", chat: GROUP, sender: A });
  assert.match(t.last(), /الساعة 21:00/);
  await t.send({ text: ".autosiyam weekly off", chat: GROUP, sender: A });
  assert.equal(siyam.get(t.app.state, GROUP).weekly, false);
  await t.send({ text: ".autos", chat: GROUP, sender: A });
  assert.match(t.last(), /تذكير صيام السنة الساعة 21:00 \(بدون الاثنين والخميس\)/);
  assert.deepEqual(stopAll(t.app.state, GROUP), ["autosiyam"]);
});

test(".khatma remind mentions members with unread juz', at most once an hour", async () => {
  const t = realBot();
  await t.send({ text: ".khatma new", chat: GROUP, sender: A });
  await t.send({ text: ".khatma take 3", chat: GROUP, sender: A });
  await t.send({ text: ".khatma take 4", chat: GROUP, sender: B });
  await t.send({ text: ".khatma done 4", chat: GROUP, sender: B });
  await t.send({ text: ".khatma remind", chat: GROUP, sender: B });
  assert.match(t.last(), /تذكير بالختمة/);
  assert.match(t.last(), /@447911123456 — الجزء ٣/);
  assert.doesNotMatch(t.last(), /447911654321/, "finished readers are not mentioned");
  assert.deepEqual(t.sock.sent.at(-1).content.mentions, [A]);
  await t.send({ text: ".khatma remind", chat: GROUP, sender: B });
  assert.match(t.last(), /مرة كل ساعة/);
  assert.deepEqual(
    khatma.openParts(khatma.get(t.app.state, GROUP)).map((o) => o.parts),
    [[3]],
  );
});
