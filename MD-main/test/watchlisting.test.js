"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const MONA = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const NOON = Date.parse("2026-10-11T09:00:00Z"); // 12:00 in Cairo
const MIN = 60 * 1000;

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: MONA }] });
  sock.onWhatsApp = async (jid) => [{ jid, exists: true }];
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME, chat = from) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "منى", message: { conversation: text } });
  re.add(app.state, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, size: 120 }, ME); // #1
  const texts = (jid) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || m.content.caption || "");
  return { app, s: app.state, send, texts, last: (jid) => texts(jid).at(-1) || "" };
}

test("a client asks to be told: saved, the agent hears once, and it shows in .listing who", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON });
  const b = bot();
  await b.send("#1", MONA);
  assert.match(b.last(MONA), /🔔 عايز نبلغك لو السعر نزل؟ ابعت: نبهني 1/, "the card offers it in a private chat");
  await b.send("نبهني", MONA); // the unit just opened
  assert.equal(b.last(MONA), "🔔 تمام، هنبلغك لو سعر #1 نزل.\nلإلغاء التنبيه: الغاء التنبيه 1");
  const lead = leads.byPhone(b.s, "201099998888");
  assert.deepEqual([lead.name, lead.watching, lead.type], ["منى", [1], "شاليه"]);
  assert.match(b.last(ME), /^🔔 منى \(\+201099998888\) طلب يتبلغ لو سعر #1 نزل — عميل مهتم بالوحدة دي\./);
  const told = b.texts(ME).length;
  await b.send("نبهني 1", MONA);
  assert.equal(b.texts(ME).length, told, "again: no second notice");
  await b.send(".listing who 1");
  assert.match(b.last(ME), /#1\* منى \(\+201099998888\) — 🔔 طلب يتبلغ/);

  await b.send("نبهني 99", MONA);
  assert.match(b.last(MONA), /^ابعت رقم الوحدة اللي عايز نبلغك عنها/);
  await b.send("#1", MONA, GROUP);
  assert.doesNotMatch(b.last(GROUP), /نبهني/, "not offered in a group");
  await b.send(".listing 1");
  assert.doesNotMatch(b.last(ME), /نبهني/, "nor to the team");
  t.mock.timers.reset();
});

test("a price cut reaches those who asked, even outside their budget; so does the unit coming back", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON - 60 * MIN });
  const b = bot();
  await b.send("نبهني 1", MONA);
  leads.update(b.s, leads.byPhone(b.s, "201099998888").id, { max: 3e6 }); // far below the price
  await b.send(".listing edit 1 السعر: 8.5 مليون");
  assert.match(b.last(ME), /🔔 1 عميل طلب يتبلغ لو سعرها نزل/);
  await b.send(".blast 1 drop");
  assert.match(b.last(ME), /Goes to 1 client\(s\)[\s\S]*منى/, "outside their budget, but they asked");
  await b.send(".blast 1 drop go");
  t.mock.timers.setTime(NOON);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "sent");
  assert.match(b.last(MONA), /📉 \*نزل سعره!\*/);
  await b.send(".blast 1 drop");
  assert.match(b.last(ME), /were all told already/, "once per price");

  await b.send(".listing status 1 reserved");
  await b.send(".listing status 1 available");
  assert.match(b.last(ME), /🔁 1 client\(s\)/);
  t.mock.timers.reset();
});

test("cancelling, وقف, and the limits", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON });
  const b = bot();
  for (let i = 2; i <= 12; i++) re.add(b.s, { type: "شقة", deal: "بيع", location: `منطقة ${i}`, price: 3e6 }, ME);
  await b.send("نبهني 1", MONA);
  await b.send("الغاء التنبيه 1", MONA);
  assert.equal(b.last(MONA), "✅ تمام، مش هنبلغك عن #1.");
  assert.equal(leads.byPhone(b.s, "201099998888").watching, undefined);

  // At most 10 units watched: the oldest goes.
  for (let i = 2; i <= 12; i++) {
    t.mock.timers.setTime(NOON + i * 3 * MIN); // past the 5-in-10-minutes limit
    await b.send(`نبهني ${i}`, MONA);
  }
  assert.deepEqual(leads.byPhone(b.s, "201099998888").watching, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  // A flood: the 6th in 10 minutes is ignored.
  t.mock.timers.setTime(NOON + 60 * MIN); // a fresh 10 minutes
  const n = b.texts(MONA).length;
  for (let i = 0; i < 6; i++) await b.send("نبهني 2", MONA);
  assert.equal(b.texts(MONA).length, n + 5);

  // وقف: no campaign reaches them, asked or not.
  await b.send("وقف", MONA);
  const { watchers } = require("../src/services/watch");
  assert.equal(watchers(b.s, 3).length, 0);
  t.mock.timers.reset();
});
