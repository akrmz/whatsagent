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
const jid = (phone) => `${phone}@s.whatsapp.net`;
const NOON = Date.parse("2026-10-08T09:00:00Z"); // 12:00 in Cairo
const MIN = 60 * 1000;

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
  const send = (text) => d.handleMessage(sock, { key: { id: `P${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3.6e6 }, ME); // #1
  const wants = { type: "شقة", deal: "بيع", location: "التجمع" };
  const ahmed = leads.add(s, { name: "أحمد", phone: "201001110001", ...wants, max: 3.5e6 }, ME); // got it before, a bit over budget then
  leads.markSent(s, ahmed.id, 1, ME, "أُرسل له العقار #1");
  const mona = leads.add(s, { name: "منى", phone: "201001110002", ...wants, max: 3.3e6 }, ME); // never sent
  leads.add(s, { name: "سارة", phone: "201001110003", ...wants, max: 2.5e6 }, ME); // still out of budget after the cut
  return { app, sock, send, s, ahmed, mona, text: () => sock.sent.at(-1).content.text || "", sentTo: (j) => sock.sent.filter((m) => m.jid === j) };
}

test("a price-drop campaign: needs a cut; goes to clients it now fits, including those who had it; each told once per price", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON - 60 * MIN });
  const b = bot();
  await b.send(".blast 1 drop");
  assert.match(b.text(), /#1 has no price cut in the last 30 days/);

  await b.send(".listing edit 1 السعر: 3.2 مليون");
  assert.match(b.text(), /📣 بلّغ كل العملاء المناسبين بالسعر الجديد: \.blast 1 drop/);
  await b.send(".blast 1 drop");
  const r = b.text();
  assert.match(r, /^📉 \*Price-drop preview — #1\*: 3\.6 مليون → 3\.2 مليون \(−11%\)/);
  assert.match(r, /Goes to 2 client\(s\) it now fits within budget \(1 got it before at the old price\):/);
  assert.match(r, /▫️ #1 أحمد \(\+201001110001\) — had it before/);
  assert.doesNotMatch(r, /سارة/, "still over her budget");

  await b.send(".blast 1 drop go");
  assert.match(b.text(), /▶️ Price-drop campaign #1 started: #1 to 2 client\(s\)/);
  t.mock.timers.setTime(NOON);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "sent");
  assert.equal(await campaigns.tick(b.app, NOON + 2 * MIN, () => 0), "sent");
  const toAhmed = b.sentTo(jid(b.ahmed.phone)).at(-1).content.text;
  assert.match(toAhmed, /^أهلاً أحمد 👋\n📉 \*نزل سعره!\* العقار اللي بعتهولك قبل كده\nبقى 3\.2 مليون بدل 3\.6 مليون جنيه \(خصم 11%\)\n\n🏠 \*شقة للبيع\* — #1/);
  assert.match(b.sentTo(jid(b.mona.phone)).at(-1).content.text, /^أهلاً منى 👋\n📉 \*نزل سعره!\*\nبقى 3\.2 مليون/);
  assert.match(b.text(), /📣 حملة تخفيض #1 للعقار #1: ✅ 2 أُرسلت من 2/);
  assert.equal(leads.get(b.s, b.mona.id).dropNotified[1], 3.2e6);
  assert.ok(leads.get(b.s, b.mona.id).sentListings.includes(1), "now counted as sent");

  await b.send(".blast 1 drop");
  assert.match(b.text(), /were all told already/);
  await b.send(".listing edit 1 السعر: 3 مليون");
  await b.send(".blast 1 drop");
  assert.match(b.text(), /Goes to 2 client\(s\)/, "a new, lower price is news again");
  t.mock.timers.reset();
});

test("a drop campaign stops if the price goes back up", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON - 60 * MIN });
  const b = bot();
  await b.send(".listing edit 1 السعر: 3.2 مليون");
  await b.send(".blast 1 drop go");
  re.update(b.s, 1, { price: 3.7e6 });
  t.mock.timers.setTime(NOON);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "done");
  assert.match(b.text(), /⏹️ أُوقفت: سعر #1 لم يعد مخفّضاً/);
  assert.equal(b.sentTo(jid(b.mona.phone)).length, 0);
  t.mock.timers.reset();
});
