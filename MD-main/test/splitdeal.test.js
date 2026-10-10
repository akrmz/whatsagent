"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const deals = require("../src/services/deals");
const team = require("../src/services/team");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");

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
  const send = (text) => d.handleMessage(sock, { key: { id: `S${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  const broker = { kind: "channel", name: "عقارات الساحل", phones: ["201005556666"] };
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل", price: 3e6, source: broker }, ME); // #1
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل", price: 3e6, source: broker }, ME); // #2
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2e6 }, ME); // #3 own
  for (const name of ["منى", "علي", "سارة"]) leads.add(s, { name, phone: `20100111000${name.length}${n++}` }, ME);
  const myCommission = () => team.month(s, team.monthOf(Date.now()))[ME]?.commission || 0;
  return { s, send, myCommission, text: () => sock.sent.at(-1).content.text || "" };
}

test("a commission shared with the broker the unit came from: your share counted, the whole and the partner kept", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".lead won 1 #1 3m 2.5% split 50%");
  assert.match(b.text(), /🧾 عمولتك: 37,500 جنيه — 50% من 75,000 جنيه \(2\.5%\) · 🤝 مع السمسار \+201005556666/);
  assert.doesNotMatch(b.text(), /lead split/, "already shared: no reminder");
  const [deal] = leads.get(b.s, 1).deals;
  assert.deepEqual([deal.commission, deal.gross, deal.split, deal.partner], [37500, 75000, 50, "201005556666"]);
  assert.equal(b.myCommission(), 37500, "the team counts your share");
  assert.equal(deals.parseDealArgs(["مناصفة"]).split, 50);
  t.mock.timers.reset();
});

test("forgot to say it was shared: reminded, then .lead split corrects the deal and the team's count", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".lead won 2 #2 3m 2.5%");
  assert.match(b.text(), /🧾 العمولة: 75,000 جنيه \(2\.5%\)\n🤝 الوحدة دي من سمسار \(\+201005556666\)\. لو العمولة مقسومة معاه: \.lead split 2 50%/);
  assert.equal(b.myCommission(), 75000);
  await b.send(".lead split 2 40%");
  assert.match(b.text(), /^🤝 #2: عمولتك 30,000 جنيه — 40% من 75,000 جنيه \(كانت 75,000 جنيه\)\nمع السمسار \+201005556666/);
  assert.equal(b.myCommission(), 30000);
  await b.send(".lead split 2 100%");
  assert.match(b.text(), /العمولة كلها ليك: 75,000 جنيه/);
  assert.equal(b.myCommission(), 75000);
  assert.equal(leads.get(b.s, 2).deals[0].split, undefined);

  // Your own unit: no reminder.
  await b.send(".lead won 3 #3 2m 2.5%");
  assert.doesNotMatch(b.text(), /سمسار/);
  // Mistakes.
  await b.send(".lead split 2 0%");
  assert.match(b.text(), /^❌ Your share: a percentage from 1 to 100/);
  await b.send(".lead won 1 #1 3m 2.5% split 150%");
  assert.match(b.text(), /^❌ Your share after split: a percentage from 1 to 99/);
  t.mock.timers.reset();
});

test(".deals counts your share and says what went to brokers", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".lead won 1 #1 3m 2.5% split 50%");
  await b.send(".lead won 2 #2 3m 2.5% مناصفة");
  await b.send(".lead won 3 #3 2m 2.5%");
  await b.send(".deals");
  const r = b.text();
  assert.match(r, /✅ 3 صفقة · 💰 8 مليون جنيه · 🧾 عمولة 125,000 جنيه/, "37,500 + 37,500 + 50,000");
  assert.match(r, /— عمولة 37,500 \(🤝 50%\)/);
  assert.match(r, /🤝 2 صفقة مع سماسرة: العمولة فوق نصيبك بس · نصيب السماسرة 75,000 جنيه/);
  t.mock.timers.reset();
});
