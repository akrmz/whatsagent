"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const drafts = require("../src/services/drafts");
const places = require("../src/services/places");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const CHANNEL = "120363111111111111@newsletter";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");
const MIN = 60 * 1000;
const POST = "شقة للبيع في التجمع الخامس 150 متر 3 غرف السعر 4.6 مليون\nاللوكيشن: https://maps.app.goo.gl/AbCdEf123\nللتواصل 01005556666";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const raw = (message, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `N${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message });
  const send = (text, opts) => raw({ conversation: text }, opts);
  const forward = (text) => raw({ extendedTextMessage: { text, contextInfo: { isForwarded: true } } });
  const s = app.state;
  // Three similar apartments (30,000 a m²) for the price check, and a client it suits.
  for (const price of [4.5e6, 4.5e6, 4.5e6]) re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price, size: 150 }, ME);
  leads.add(s, { name: "منى", phone: "201001110001", type: "شقة", deal: "بيع", location: "التجمع", max: 5e6 }, ME);
  return { app, s, sock, raw, send, forward, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || m.content.caption || "").at(-1) || "" };
}

function stubMaps(t) {
  places.setRequester(async (url) => (/goo\.gl/.test(url) ? { status: 302, redirect: "https://www.google.com/maps/place/@30.0074,31.4913,17z" } : { status: 200 }));
  t.after(() => places.setRequester(null));
}

test("a draft saved as a listing gets what .listing add gives: the pin from a short Maps link, the price check, the clients, the campaign", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  stubMaps(t);
  const b = bot();
  await b.send(".agent autoblast on");
  await b.forward(POST);
  await b.send(".drafts save 1");
  const r = b.last();
  assert.match(r, /^✅ Draft #1 is now listing \*#4\*/);
  assert.match(r, /📈 سعر المتر 30,667 جنيه — في حدود المتوسط ✅ \(متوسط 3 عقار مشابه/);
  assert.match(r, /🎯 يناسب 1 من عملائك: #1 منى/);
  assert.match(r, /📣 Campaign #1: it goes to 1 matching client\(s\) from/);
  assert.deepEqual(re.get(b.s, 4).geo && [re.get(b.s, 4).geo.lat, re.get(b.s, 4).geo.lng], [30.0074, 31.4913]);
  t.mock.timers.reset();
});

test(".drafts save all: summed up, campaigns counted, duplicates flagged and not sent", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  stubMaps(t);
  const b = bot();
  await b.send(".agent autoblast on");
  await b.forward(POST);
  t.mock.timers.setTime(NOW + 3 * MIN);
  await b.forward("شقة للبيع في التجمع الخامس 150 متر السعر 4.5 مليون"); // the same as #1–#3
  t.mock.timers.setTime(NOW + 6 * MIN);
  await b.forward("صباح الخير 🌞 أسعار جديدة قريب"); // not a unit: not collected at all
  await b.send(".drafts save all");
  assert.match(b.last(), /^✅ 2 saved as listings: #4، #5 \(⚠️ زي #1\)\n📣 1 campaign\(s\) queued/);
  t.mock.timers.reset();
});

test(".drafts save 3 ai: the AI reads a messy post (numbers masked); details after it still win", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  let asked = "";
  b.app.capabilities = { ...ALL_OFF, ai: true };
  b.app.ai = {
    ask: async (prompt) => {
      asked = prompt;
      return '{"type":"فيلا","deal":"بيع","location":"الشيخ زايد","price":12000000,"size":400}';
    },
  };
  await b.forward("🔥🔥 فرصه فيلا ف زايد 4٠٠م ب 12م بس كلمني 01005556666");
  await b.send(".drafts save 1 ai الغرف: 5");
  const l = re.get(b.s, 4);
  assert.deepEqual([l.type, l.location, l.price, l.size, l.rooms], ["فيلا", "الشيخ زايد", 12e6, 400, 5]);
  assert.doesNotMatch(asked, /01005556666|1005556666/, "the poster's number never goes to the AI");
  t.mock.timers.reset();
});

test(".sellers add and a channel with auto give the same; a channel added in a mixed group reports to the owner privately", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  stubMaps(t);
  const b = bot();
  b.sock.newsletterMetadata = async () => ({ id: CHANNEL, name: "قناتي", viewer_metadata: { role: "OWNER" } });
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN auto", { from: ME, chat: GROUP });
  assert.equal(require("../src/services/channels").get(b.s, CHANNEL).notify, ME, "a group with a client in it: the owner's private chat instead");
  await b.raw({ conversation: POST }, { from: CHANNEL, chat: CHANNEL });
  t.mock.timers.setTime(NOW + 3 * MIN);
  await drafts.runDue(b.app, NOW + 3 * MIN);
  const msg = b.last(ME);
  assert.match(msg, /^✅ اتضاف \*#4\* من قناة "قناتي"/);
  assert.match(msg, /📈 سعر المتر 30,667 جنيه/);
  assert.match(msg, /🎯 يناسب 1 من عملائك: #1 منى/);
  assert.ok(re.get(b.s, 4).geo, "the short Maps link opened (limited for outside posts)");
  assert.equal(b.sock.sent.filter((m) => m.jid === GROUP && /منى|01005556666/.test(m.content.text || "")).length, 0);
  t.mock.timers.reset();
});
