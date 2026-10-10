"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const digest = require("../src/services/digest");
const { advice, funnel } = require("../src/services/slowlistings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const NOW = Date.parse("2026-10-10T09:00:00Z"); // a Saturday, 12:00 in Cairo
const DAY = 86400000;

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `S${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, s: app.state, send, text: () => sock.sent.at(-1).content.text || "" };
}

/** A catalogue added 90 days ago (and a few recent ones), with what happened to each. */
function catalogue(t, s) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW - 90 * DAY });
  const add = (f, extra = {}) => {
    const id = re.add(s, { deal: "بيع", ...f }, ME).id;
    re.update(s, id, { photos: 1, ...extra });
    return id;
  };
  const ids = {
    noPhotos: re.add(s, { type: "شقة", location: "التجمع الخامس", price: 3e6, size: 150 }, ME).id,
    unseen: add({ type: "شقة", location: "التجمع الخامس", price: 3e6, size: 150 }, { stats: { views: 3 } }),
    warm: add({ type: "شاليه", location: "الساحل الشمالي", price: 6e6, size: 120 }, { stats: { views: 15, booked: 2 }, feedback: [{ result: "liked" }, { result: "no" }] }),
    dear: add({ type: "شاليه", location: "الساحل الشمالي", price: 8.4e6, size: 120 }, { stats: { views: 30 } }),
    silent: add({ type: "فيلا", location: "الشيخ زايد", price: 15e6, size: 400 }, { stats: { views: 25, sent: 5 } }),
    reserved: add({ type: "شقة", location: "التجمع", price: 2e6 }, { status: "reserved" }),
  };
  t.mock.timers.setTime(NOW - 10 * DAY);
  ids.recent = add({ type: "فيلا", location: "الشيخ زايد", price: 14e6, size: 400 });
  for (const price of [6e6, 6e6, 6e6]) add({ type: "شاليه", location: "الساحل الشمالي", price, size: 120 }); // the market: 50,000 a m²
  t.mock.timers.setTime(NOW);
  return ids;
}

test(".listings slow: units 30+ days on the market by type, the oldest first, with the funnel and the next step", async (t) => {
  const b = bot();
  const ids = catalogue(t, b.s);
  await b.send(".listings slow");
  const r = b.text();
  assert.match(r, /^🐢 \*Slow listings\* — 5 of 9 available, on the market 30\+ days, the oldest first/);
  assert.match(r, /\*شقة\* \(2\)\n▫️ \*#1\* شقة للبيع — التجمع الخامس — 3 مليون جنيه · 150م² · 90 يوم\n {3}👀 0 · 💬 0 · 🏠 0\n {3}📷 من غير صور/);
  assert.match(r, /\*#2\*.*\n {3}👀 3 · 💬 0 · 🏠 0\n {3}📣 قليل الظهور: اتشاف واتبعت 3 مرات بس\n {3}↳ \.blast 2 · \.statuspost 2/);
  assert.match(r, /\*#3\*.*\n {3}👀 15 · 💬 0 · 🏠 2 \(👍 1 👎 1\) · 📈 0%\n {3}🤝 فيه 1 مهتم بعد المعاينة: تابعهم قبل ما يبردوا\n {3}↳ \.listing who 3/);
  assert.match(r, /\*#4\*.*\n {3}👀 30 · 💬 0 · 🏠 0 · 📈 \+40%\n {3}💰 سعر المتر أعلى من المشابه بـ 40%: كلم المالك في السعر بالأرقام\n {3}↳ \.listing report 4 send · \.market 4/);
  assert.match(r, /\*فيلا\* \(1\)\n▫️ \*#5\*.*\n {3}👀 25 · 📣 5 · 💬 0 · 🏠 0\n {3}🤐 اتشاف 30 مرة ومحدش سأل/);
  assert.doesNotMatch(r, /#6\b|\*#7\*/, "not the reserved one, nor the one added 10 days ago");
  assert.ok(r.indexOf("*شقة*") < r.indexOf("*شاليه*") && r.indexOf("*شاليه*") < r.indexOf("*فيلا*"), "apartments, chalets and villas apart");
  assert.equal(ids.recent, 7);

  await b.send(".listings slow 100");
  assert.match(b.text(), /^✅ None of your 9 available listing\(s\) has been on the market for 100 days or more\./);
  await b.send(".listings slow", CLIENT);
  assert.match(b.text(), /^Only the owner and sudo users see how listings are doing/);

  // A unit that came back on the market counts from its return.
  re.update(b.s, ids.unseen, { status: "reserved" });
  re.update(b.s, ids.unseen, { status: "available" });
  await b.send(".listings slow");
  assert.doesNotMatch(b.text(), /\*#2\*/);
  t.mock.timers.reset();
});

test("the Saturday summary counts the units 60+ days on the market by type", (t) => {
  const b = bot();
  catalogue(t, b.s);
  assert.match(digest.build(b.s, "Africa/Cairo", NOW), /🐢 معروضة من 60\+ يوم: شقة 2 · شاليه 2 · فيلا 1 — ليه مش بتتباع؟ \.listings slow 60/);
  assert.doesNotMatch(digest.build(b.s, "Africa/Cairo", NOW + DAY), /🐢/, "Saturdays only");
  t.mock.timers.reset();
});

test("the advice: viewers who didn't like it, questions without viewings, no-shows, and a push", () => {
  const l = { id: 9, photos: 2 };
  const of = (stats, feedback = []) => advice(l, funnel({ stats, feedback }), null).key;
  assert.equal(of({ views: 40, booked: 3 }, [{ result: "no" }, { result: "no" }, { result: "noshow" }]), "disliked");
  assert.equal(of({ views: 40, inquiries: 4 }), "noviewing");
  assert.equal(of({ views: 40, inquiries: 1, booked: 2 }, [{ result: "noshow" }, { result: "noshow" }]), "noshow");
  assert.equal(of({ views: 12, inquiries: 1 }), "push");
  assert.equal(advice(l, funnel({ stats: { views: 12, inquiries: 1 } }), 15).key, "price", "above the market, even without much else");
});
