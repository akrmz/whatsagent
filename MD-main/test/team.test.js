"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const team = require("../src/services/team");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const TEAM = "201033334444@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`);

function bot() {
  team.setTimeZone("Africa/Cairo");
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, mentions } = {}) =>
    d.handleMessage(sock, { key: { id: `T${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: mentions ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } } : { conversation: text } });
  return { app, sock, send, s: app.state, last: () => sock.sent.at(-1).content };
}

test("monthly counters: by month in the bot's time zone, per person, 24 months kept", () => {
  const b = bot();
  team.record(b.s, ME, "sent", 1, at("2026-09-30", "23:30")); // still September in Cairo (20:30 UTC)
  team.record(b.s, ME, "sent", 1, at("2026-10-01", "01:00")); // October in Cairo, still September in UTC
  team.record(b.s, ME, "commission", 50000, at("2026-10-02"));
  team.record(b.s, ME, "nonsense", 1, at("2026-10-02"));
  team.record(b.s, null, "sent", 1, at("2026-10-02"));
  assert.deepEqual(team.month(b.s, "2026-09"), { [ME]: { sent: 1 } });
  assert.deepEqual(team.month(b.s, "2026-10"), { [ME]: { sent: 1, commission: 50000 } });
  for (let m = 0; m < 30; m++) team.record(b.s, ME, "leads", 1, Date.UTC(2027, m, 15));
  assert.equal(Object.keys(b.s.store("team-stats").data).length, 24);
});

test(".team: each member's month, merged and sorted; automatic work grouped; assigned clients", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-08", "10:00") });
  const b = bot();
  await b.send(`.sudo add ${TEAM.split("@")[0]}`);
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); // #1
  re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME); // #2

  // The owner adds a client and sends a listing.
  await b.send(".lead add\nالاسم: أحمد\nالموبايل: 01001110001\nالنوع: شقة\nالمنطقة: التجمع");
  await b.send(".lead send 1 1");
  // The team member adds a client, books a viewing and closes a deal.
  await b.send(".lead add\nالاسم: منى\nالموبايل: 01001110002", { from: TEAM });
  await b.send(".viewing add 2 2 tomorrow at 4pm", { from: TEAM });
  await b.send(".lead won 2 #2 9m 2%", { from: TEAM });
  await b.send(".lead assign 1 @member", { mentions: [TEAM] });
  // A client asking about #1 is saved automatically.
  await b.send(".agent autoleads on");
  await b.send("#1", { from: CLIENT });

  await b.send(".team");
  const r = b.last();
  assert.match(r.text, /^👥 \*أداء الفريق — أكتوبر 2026\*\n\n▫️ @201033334444: ➕ 1 عميل · 📤 0 إرسال · 👀 1 معاينة · ✅ 1 صفقة · 🧾 180,000 جنيه · 📂 1 عميل مسند\n▫️ @201011112222: ➕ 1 عميل · 📤 1 إرسال · 👀 0 معاينة · ✅ 0 صفقة\n▫️ 🤖 تلقائي: ➕ 1 عميل · 📤 0 إرسال/);
  assert.deepEqual(r.mentions, [TEAM, ME]);
  assert.match(leads.card(leads.get(b.s, 1)), /المسؤول: @201033334444/);

  await b.send(".team last");
  assert.match(b.last().text, /سبتمبر 2026\*\n\nNothing recorded for 2026-09 yet/);
  await b.send(".team soon");
  assert.match(b.last().text, /Usage: \.team/);
  await b.send(".team", { from: CLIENT });
  assert.doesNotMatch(b.last().text || "", /أداء الفريق/, "owner and sudo only");
  t.mock.timers.reset();
});
