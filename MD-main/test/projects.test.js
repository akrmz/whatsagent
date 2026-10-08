"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const projects = require("../src/services/projects");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `P${++n}`, remoteJid: from, fromMe: false }, pushName: "Mona", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "", sentTo: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

const MOUNTAIN = "المشروع: ماونتن فيو آي سيتي\nالمطور: ماونتن فيو\nالمنطقة: التجمع الخامس\nالوحدات: شقق من 120 لـ 200 م، تاون هاوس، فيلات\nيبدأ من: 6.5 مليون\nالمقدم: 10%\nالتقسيط: 8 سنوات\nالاستلام: 2028\nالصيانة: 8%\nنادي وحمامات سباحة";

function catalogue(s) {
  projects.add(s, projects.parseProjectText(MOUNTAIN), ME); // P1
  projects.add(s, projects.parseProjectText("المشروع: بالم هيلز نيو كايرو\nالمنطقة: التجمع الخامس\nالوحدات: فيلات وتوين هاوس من 250 لـ 400 م\nيبدأ من: 14 مليون\nالمقدم: 5%\nالتقسيط: 10 سنوات\nالاستلام: فوري"), ME); // P2
  projects.add(s, projects.parseProjectText("المشروع: زايد ديونز\nالمنطقة: الشيخ زايد\nالوحدات: شقق\nيبدأ من: 4.2 مليون\nالمقدم: بدون مقدم\nالتقسيط: 96 شهر\nالاستلام: 2027"), ME); // P3
}

test("reading a project: plan, delivery, unit types and sizes; the card works out the instalment", () => {
  const f = projects.parseProjectText(MOUNTAIN);
  assert.deepEqual(f, {
    name: "ماونتن فيو آي سيتي", developer: "ماونتن فيو", location: "التجمع الخامس", units: "شقق من 120 لـ 200 م، تاون هاوس، فيلات",
    price: 6.5e6, down: 10, years: 8, delivery: "2028", deliveryYear: 2028, maint: 8, notes: "نادي وحمامات سباحة", types: ["شقة", "فيلا", "تاون هاوس"], sizes: [120, 200],
  });
  assert.deepEqual(projects.parseProjectText("المشروع: س\nالمقدم: بدون مقدم\nالتقسيط: 96 شهر\nالاستلام: استلام فوري"), { name: "س", down: 0, years: 8, delivery: "استلام فوري", ready: true });
  const card = projects.card({ id: 1, ...f }, { currency: "جنيه" });
  assert.match(card, /💰 يبدأ من: \*6,500,000 جنيه\* \(6\.5 مليون\)\n💳 مقدم 10% · 8 سنين · استلام 2028\n {3}≈ 182,813 جنيه ربع سنوي \(≈ 60,938 جنيه شهرياً\) بعد مقدم 650,000 جنيه — لأقل وحدة/);
});

test("search and matching: area, starting price, down payment, years, ready, unit type; renters never match", () => {
  const s = bot().s;
  catalogue(s);
  const ids = (q) => projects.search(s, q).list.map((p) => p.id);
  assert.deepEqual(ids(""), [3, 1, 2], "cheapest first");
  assert.deepEqual(ids("التجمع"), [1, 2]);
  assert.deepEqual(ids("حتى 8 مليون"), [3, 1]);
  assert.deepEqual(ids("مقدم 5%"), [3, 2]);
  assert.deepEqual(ids("10 سنين"), [2]);
  assert.deepEqual(ids("فوري"), [2]);
  assert.deepEqual(ids("فيلا التجمع"), [1, 2]);
  assert.deepEqual(ids("شقة زايد"), [3]);
  assert.equal(projects.suits(projects.get(s, 1), { type: "شقة", location: "التجمع", max: 7e6 }), true);
  assert.equal(projects.suits(projects.get(s, 1), { type: "شقة", location: "التجمع", max: 5e6 }), false, "over budget");
  assert.equal(projects.suits(projects.get(s, 1), { type: "محل", location: "التجمع" }), false, "no shops there");
  assert.equal(projects.suits(projects.get(s, 1), { type: "شقة", deal: "إيجار", location: "التجمع" }), false, "projects are for buyers");
  assert.equal(projects.suits(projects.get(s, 1), {}), false, "no wishes, no match");
});

test(".project and .projects; projects on the client card and in answers to requests", async () => {
  const b = bot();
  await b.send(`.project add\n${MOUNTAIN}`);
  assert.match(b.text(), /^✅ Saved as \*P1\*\n\n🏗️ \*ماونتن فيو آي سيتي\* — P1/);
  await b.send(".project add\nالمشروع: مشروع ناقص\nالمنطقة: أكتوبر");
  assert.match(b.text(), /⚠️ Missing: يبدأ من، المقدم، التقسيط، الاستلام/);
  await b.send(".project edit 2 المقدم: 15%\nيبدأ من: 3 مليون");
  assert.match(b.text(), /✏️ Updated P2: down, price/);
  await b.send(".project del 2");
  assert.match(b.text(), /Deleted P2/);

  await b.send(".project p1", CLIENT);
  assert.match(b.text(), /🏗️ \*ماونتن فيو آي سيتي\* — P1/, "anyone can view");
  await b.send(".project add\nالمشروع: x", CLIENT);
  assert.match(b.text(), /Only the owner and sudo users manage projects/);
  await b.send(".projects التجمع مقدم 10%", CLIENT);
  assert.match(b.text(), /🏗️ \*1 مشروع\*\n\n\*P1\* ماونتن فيو آي سيتي — التجمع الخامس — يبدأ 6\.5 مليون جنيه · مقدم 10% · 8 سنين · استلام 2028/);

  const lead = leads.add(b.s, { name: "أحمد", phone: "201001110001", type: "شقة", location: "التجمع", max: 7e6 }, ME);
  await b.send(`.lead ${lead.id}`);
  assert.match(b.text(), /🏗️ \*مشروعات مناسبة \(1\):\*\n\*P1\* ماونتن فيو/);
  await b.send(".project 1");
  assert.match(b.text(), /🎯 يناسب 1 من عملائك: #1 أحمد/);

  await b.send(".agent requests on");
  await b.send("عايز شقة في التجمع ميزانية 7 مليون", CLIENT);
  const answer = b.sentTo(CLIENT).at(-1).content.text;
  assert.match(answer, /وصلني طلبك \(شقة، في التجمع، حتى 7 مليون جنيه\) 👍\n\n🏗️ مشروعات جديدة بالتقسيط تناسبك:\n\*P1\* ماونتن فيو آي سيتي/);
  assert.match(answer, /هتواصل معاك بالتفاصيل وخطط السداد\.$/);
  assert.match(b.sentTo(ME).at(-1).content.text, /لا يوجد عقار مطابق\n🏗️ مشروعات: P1/);

  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 5e6 }, ME);
  await b.send("محتاج شقة في التجمع ميزانية 7 مليون", "201077776666@s.whatsapp.net");
  assert.match(b.sentTo("201077776666@s.whatsapp.net").at(-1).content.text, /\*#1\* شقة للبيع — التجمع[^\n]*\n\n🏗️ ومشروعات جديدة بالتقسيط تناسبك:\n\*P1\*/);
});
