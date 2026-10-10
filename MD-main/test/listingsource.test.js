"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const drafts = require("../src/services/drafts");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";
const CHANNEL = "120363111111111111@newsletter";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  app.health.state = "open";
  sock.newsletterMetadata = async () => ({ id: CHANNEL, name: "عقارات الساحل", viewer_metadata: { role: "SUBSCRIBER" } });
  const d = createDispatcher(app);
  let n = 0;
  const raw = (message, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `L${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message });
  const send = (text, opts) => raw({ conversation: text }, opts);
  return { app, s: app.state, sock, raw, send, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || m.content.caption || "").at(-1) || "" };
}

test("a unit from a channel keeps where it came from and the poster's number, privately: who to call about it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".channel add https://whatsapp.com/channel/0029VaABCDEFGHIJKLMN");
  await b.raw({ conversation: "شاليه للبيع في الساحل الشمالي 120 متر السعر 9 مليون\nللتواصل 01005556666 أو 01007778888" }, { from: CHANNEL, chat: CHANNEL });
  t.mock.timers.setTime(NOW + 3 * 60 * 1000);
  await drafts.runDue(b.app, NOW + 3 * 60 * 1000);
  await b.send(".drafts save 1");
  assert.match(b.last(), /🔗 المصدر \(خاص\): قناة "عقارات الساحل" · \+201005556666 wa\.me\/201005556666 · \+201007778888 wa\.me\/201007778888/, "in the save reply (the owner's private chat)");

  await b.send(".listing 1");
  assert.match(b.last(), /🔗 المصدر \(خاص\): قناة "عقارات الساحل"/);
  await b.send(".listing 1", { from: ME, chat: GROUP });
  assert.doesNotMatch(b.last(GROUP), /المصدر|1005556666/, "not in a group");
  await b.send("#1", { from: CLIENT });
  assert.doesNotMatch(b.last(CLIENT), /المصدر|1005556666/, "never to a client");

  await b.send(".export listings");
  const csv = b.sock.sent.at(-1).content.document.toString("utf8");
  assert.match(csv, /,source,/);
  assert.match(csv, /قناة ""عقارات الساحل"" · \+201005556666/);
  t.mock.timers.reset();
});

test("export then import keeps the source private: back in its field, never in the public notes", async () => {
  const a = bot();
  re.add(a.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6, size: 150, source: { kind: "channel", name: "عقارات الساحل", phones: ["201005556666"] } }, ME);
  await a.send(".export listings");
  const file = a.sock.sent.at(-1).content.document.toString("utf8");
  const b = bot();
  const r = require("../src/commands/realestate/office").importCsv(b.s, file, "listings", { by: ME, ownerNumber: "201011112222" });
  assert.equal(r.added, 1);
  const l = re.get(b.s, 1);
  assert.deepEqual(l.source.phones, ["201005556666"]);
  assert.match(l.source.name, /عقارات الساحل/);
  assert.doesNotMatch(`${l.notes || ""} ${re.card(l, re.agent(b.s))}`, /1005556666|source|المصدر/, "not public");
});

test("the viewing day plan says which broker to call when the owner isn't saved", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  const l = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, source: { kind: "forward", phones: ["201005556666"] } }, ME).id;
  const lead = require("../src/services/leads").add(b.s, { name: "منى", phone: "201001110001" }, ME).id;
  require("../src/services/viewings").add(b.s, { lead, listing: l, at: Date.parse("2026-10-12T11:00:00+03:00"), chat: ME, by: ME }, NOW);
  await b.send(".viewings tomorrow");
  assert.match(b.last(), /🔗 السمسار \+201005556666/);
  t.mock.timers.reset();
});
