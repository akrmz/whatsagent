"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const adhan = require("../src/services/adhan");
const azkar = require("../src/services/azkar");
const { syncIdentities } = require("../src/services/identity-sync");
const { groupData } = require("../src/services/settings");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const CHAT = "120363000000000007@g.us";
const USER = "447911123456@s.whatsapp.net";
const at = (iso) => Date.parse(iso);

/** Fake geocoder + aladhan for Makkah (UTC+3), as in islamic.test.js. */
const makkah = {
  geocode: async () => ({ name: "Mecca", latitude: 21.42, longitude: 39.83, timezone: "Asia/Riyadh" }),
  getJson: async () => ({ data: { timings: { Fajr: "04:57", Sunrise: "06:13", Dhuhr: "12:09", Asr: "15:32", Maghrib: "18:04", Isha: "19:34" }, meta: { method: { name: "Umm Al-Qura" } } } }),
};

function app() {
  const a = makeApp({ env: { TIMEZONE: "Africa/Cairo" } });
  a.sock = makeSock();
  a.health.state = "open";
  return a;
}

test("adhkar after each prayer: N minutes after the adhan, Fajr/Maghrib-only adhkar only then", async () => {
  const a = app();
  adhan.set(a.state, CHAT, "Makkah");
  adhan.setAfter(a.state, CHAT, 25);
  // Different days from islamic.test.js (the prayer-times cache is per day).
  assert.equal(await adhan.runDue(a, at("2026-11-12T01:58:00Z"), makkah), 1, "04:58: the Fajr adhan");
  assert.equal(await adhan.runDue(a, at("2026-11-12T02:10:00Z"), makkah), 0, "05:10: not yet");
  assert.equal(await adhan.runDue(a, at("2026-11-12T02:23:00Z"), makkah), 1, "05:23: adhkar after Fajr (04:57 + 25)");
  const fajr = a.sock.sent.at(-1).content.text;
  assert.match(fajr, /^🕌 \*الأذكار بعد صلاة الفجر\*/);
  const [maghribFajr, fajrOnly] = azkar.chapterItems(25).slice(6, 8).map((x) => x.text); // the book notes these two
  assert.ok(fajr.includes(maghribFajr) && fajr.includes(fajrOnly));
  assert.equal(await adhan.runDue(a, at("2026-11-12T02:30:00Z"), makkah), 0, "once");

  assert.equal(await adhan.runDue(a, at("2026-11-12T09:10:00Z"), makkah), 1, "12:10: Dhuhr adhan");
  assert.equal(await adhan.runDue(a, at("2026-11-12T09:35:00Z"), makkah), 1, "12:35: after Dhuhr");
  const dhuhr = a.sock.sent.at(-1).content.text;
  assert.match(dhuhr, /الأذكار بعد صلاة الظهر/);
  assert.ok(!dhuhr.includes(maghribFajr) && !dhuhr.includes(fajrOnly), "the Fajr/Maghrib-only adhkar are left out");

  adhan.set(a.state, CHAT, "Makkah"); // changing the city keeps the option
  assert.equal(adhan.get(a.state, CHAT).after, 25);
  adhan.setAfter(a.state, CHAT, null);
  assert.equal(adhan.events(adhan.get(a.state, CHAT), { times: { Fajr: 300, Dhuhr: 729, Asr: 932, Maghrib: 1084, Isha: 1174 } }).length, 5, "off: only the adhans");
});

test(".autoprayer azkar on/off from chat", async () => {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const a = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  a.sock = makeSock({ participants: [{ id: USER }] });
  const d = createDispatcher(a);
  const send = (text) => d.handleMessage(a.sock, makeMsg({ text, chat: CHAT, sender: USER }));
  const last = () => a.sock.sent.at(-1).content.text;
  await send(".autoprayer azkar on");
  assert.match(last(), /شغّل تنبيهات الصلاة أولاً/);
  adhan.set(a.state, CHAT, "Makkah");
  const prayertimes = require("../src/services/prayertimes");
  const original = prayertimes.forCity;
  prayertimes.forCity = (city, now) => original(city, now, makkah);
  try {
    await send(".autoprayer azkar on 70");
    assert.match(last(), /من 10 إلى 60/);
    await send(".autoprayer azkar on 20");
    assert.match(last(), /بعد كل أذان بـ20 دقيقة/);
    assert.equal(adhan.get(a.state, CHAT).after, 20);
    await send(".autoprayer");
    assert.match(last(), /أذكار بعد الصلاة: بعد الأذان بـ20 دقيقة/);
    await send(".autos");
    assert.match(last(), /تنبيهات الصلاة — Makkah \+ أذكار بعد الصلاة/);
    await send(".autoprayer azkar off");
    assert.equal(adhan.get(a.state, CHAT).after, undefined);
  } finally {
    prayertimes.forCity = original;
  }
});

test("adhkar before sleep: a daily time in .autoazkar", async () => {
  const entry = { morning: "06:30", evening: "17:00", sleep: "22:30", done: {} };
  const due = (iso) => azkar.dueFor(entry, "Africa/Cairo", at(iso)).then((list) => list.map((x) => x.kind));
  assert.deepEqual(await due("2026-10-07T19:29:00Z"), [], "22:29 Cairo");
  assert.ok((await due("2026-10-07T19:31:00Z")).includes("sleep"), "22:31 Cairo");
  assert.ok(!(await azkar.dueFor({ ...entry, sleep: null }, "Africa/Cairo", at("2026-10-07T19:31:00Z"))).some((x) => x.kind === "sleep"), "off by default");
  assert.match(azkar.setText("sleep"), /^🌙 \*أذكار النوم\*/);

  const a = app();
  azkar.setAuto(a.state, CHAT, { sleep: "22:30", done: { morning: "2026-10-07", evening: "2026-10-07" } });
  assert.equal(await azkar.runDue(a, at("2026-10-07T19:31:00Z")), 1);
  assert.match(a.sock.sent.at(-1).content.text, /أذكار النوم/);
  assert.equal(await azkar.runDue(a, at("2026-10-07T19:40:00Z")), 0, "once a day");
});

test("identity sync runs at most every 30 minutes, unless the owner/sudo list changed", async () => {
  const a = makeApp();
  let calls = 0;
  const sock = { onWhatsApp: async () => (calls++, []), groupFetchAllParticipating: async () => ({}) };
  await syncIdentities(a, sock, 0);
  assert.deepEqual(await syncIdentities(a, sock, 5 * 60 * 1000), { skipped: true }, "a reconnect 5 minutes later");
  groupData(a.state).update((d) => (d.sudo = ["201011112222@s.whatsapp.net"]));
  assert.equal((await syncIdentities(a, sock, 6 * 60 * 1000)).skipped, undefined, "the sudo list changed");
  assert.deepEqual(await syncIdentities(a, sock, 20 * 60 * 1000), { skipped: true });
  assert.equal((await syncIdentities(a, sock, 40 * 60 * 1000)).skipped, undefined, "30 minutes passed");
  assert.equal(calls, 3);
});
