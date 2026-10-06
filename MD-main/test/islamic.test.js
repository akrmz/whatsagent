"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const adhan = require("../src/services/adhan");
const azkar = require("../src/services/azkar");
const hijri = require("../src/services/hijri");
const prayertimes = require("../src/services/prayertimes");
const { makeApp, makeSock } = require("./helpers");

const CHAT = "120363000000000000@g.us";

/** Fake geocoder + aladhan for Makkah (UTC+3), so the tests need no network. */
const makkah = {
  geocode: async () => ({ name: "Mecca", latitude: 21.42, longitude: 39.83, timezone: "Asia/Riyadh" }),
  getJson: async (url) => {
    assert.match(url, /^https:\/\/api\.aladhan\.com\/v1\/timings\/\d{2}-\d{2}-\d{4}\?/);
    return { data: { timings: { Fajr: "04:57", Sunrise: "06:13", Dhuhr: "12:09", Asr: "15:32", Maghrib: "18:04", Isha: "19:34" }, meta: { method: { name: "Umm Al-Qura" } } } };
  },
};
// Each test uses its own "day" so the per-day cache doesn't mix them up.
const at = (iso) => Date.parse(iso);

test("prayer times are read in the city's own time zone", async () => {
  // 01:00 UTC on 2026-11-01 is 04:00 in Makkah: before Fajr, same local day.
  const p = await prayertimes.forCity("Makkah", at("2026-11-01T01:00:00Z"), makkah);
  assert.equal(p.zone, "Asia/Riyadh");
  assert.equal(p.day, "2026-11-01");
  assert.equal(p.minutes, 4 * 60);
  assert.equal(p.times.Maghrib, 18 * 60 + 4);
});

test("prayer alerts: each prayer once, on time, never more than 20 minutes late", async () => {
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" } }); // the bot's zone differs from Makkah's on purpose
  app.sock = makeSock();
  app.health.state = "open";
  adhan.set(app.state, CHAT, "Makkah");
  assert.equal(await adhan.runDue(app, at("2026-11-02T01:50:00Z"), makkah), 0, "04:50 Makkah: before Fajr");
  assert.equal(await adhan.runDue(app, at("2026-11-02T01:58:00Z"), makkah), 1, "04:58 Makkah: Fajr");
  assert.match(app.sock.sent.at(-1).content.text, /^🕌 حان الآن موعد أذان \*الفجر\* \(04:57\) بتوقيت Mecca/);
  assert.equal(await adhan.runDue(app, at("2026-11-02T02:00:00Z"), makkah), 0, "not twice");
  assert.equal(await adhan.runDue(app, at("2026-11-02T09:00:00Z"), makkah), 0, "12:00 Makkah: Dhuhr not yet");
  assert.equal(await adhan.runDue(app, at("2026-11-02T13:00:00Z"), makkah), 0, "16:00: Asr was 28 min ago — skipped, not sent late");
  assert.equal(await adhan.runDue(app, at("2026-11-02T15:05:00Z"), makkah), 1, "18:05: Maghrib");
  assert.match(app.sock.sent.at(-1).content.text, /المغرب/);
});

test("turning prayer alerts on at noon doesn't announce Fajr late", async () => {
  const app = makeApp();
  adhan.set(app.state, CHAT, "Makkah");
  await adhan.skipPassed(app.state, CHAT, at("2026-11-03T09:00:00Z"), makkah); // 12:00 Makkah
  const due = await adhan.dueFor(adhan.get(app.state, CHAT), at("2026-11-03T09:05:00Z"), makkah);
  assert.deepEqual(due.map((d) => d.name), [], "Fajr is done; Dhuhr (12:09) not yet");
  assert.deepEqual((await adhan.dueFor(adhan.get(app.state, CHAT), at("2026-11-03T09:10:00Z"), makkah)).map((d) => d.name), ["Dhuhr"]);
});

test("daily adhkar with a city use that city's clock, not the bot's TIMEZONE", async () => {
  const entry = { city: "Makkah", done: {} };
  // Morning adhkar = Fajr (04:57) + 30 = 05:27 Makkah = 02:27 UTC. The bot's zone (London) must not matter.
  assert.deepEqual(await azkar.dueFor(entry, "Europe/London", at("2026-11-04T02:20:00Z"), makkah), []);
  const due = await azkar.dueFor(entry, "Europe/London", at("2026-11-04T02:28:00Z"), makkah);
  assert.deepEqual(due.map((d) => [d.kind, d.zone, d.day]), [["morning", "Asia/Riyadh", "2026-11-04"]]);
});

test("Hijri dates (Umm al-Qura) and the next occasions", () => {
  const h = hijri.toHijri(new Date("2026-10-06T10:00:00Z"), "Africa/Cairo");
  assert.deepEqual(h, { day: 25, month: 4, year: 1448, monthName: "ربيع الآخر" });
  assert.equal(hijri.format(h), "25 ربيع الآخر 1448 هـ");
  const ramadan = hijri.nextOccurrence(9, 1, new Date("2026-10-06T10:00:00Z"), "Africa/Cairo");
  assert.equal(ramadan.date.toISOString().slice(0, 10), "2027-02-08");
  const list = hijri.upcoming(new Date("2026-10-06T10:00:00Z"));
  assert.equal(list[0].name, "بداية شهر رمضان");
  assert.ok(list.every((o, i) => i === 0 || o.days >= list[i - 1].days), "soonest first");
});
