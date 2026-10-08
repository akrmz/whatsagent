"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
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
  const send = (text, from = CLIENT) => d.handleMessage(sock, { key: { id: `P${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  re.setAgent(app.state, "name", "Ahmed");
  projects.add(app.state, projects.parseProjectText("المشروع: ماونتن فيو آي سيتي\nالمطور: ماونتن فيو\nالمنطقة: التجمع الخامس\nالوحدات: شقق من 120 لـ 200 م، تاون هاوس، فيلات\nيبدأ من: 6.5 مليون\nالمقدم: 10%\nالتقسيط: 8 سنوات\nالاستلام: 2028\nالصيانة: 8%"), ME);
  return { app, sock, send, sentTo: (j) => sock.sent.filter((m) => m.jid === j), text: () => sock.sent.at(-1).content.text || "" };
}

test("P1 / #P1 show the project card; P1 en and .project 1 en in English; unknown codes pass through", async () => {
  const b = bot();
  await b.send("P1");
  assert.match(b.text(), /^🏗️ \*ماونتن فيو آي سيتي\* — P1/);
  assert.match(b.text(), /\nللاستفسار أرسل: P1\n/);

  await b.send("#p1 en", "201077776666@s.whatsapp.net");
  assert.equal(
    b.text(),
    "🏗️ *ماونتن فيو آي سيتي* — P1\n🏢 Developer: ماونتن فيو\n📍 Fifth Settlement, New Cairo\n🏠 Units: Apartments, Villas, Townhouses · 120–200 m²\n💰 From *EGP 6,500,000* (EGP 6.5M)\n💳 10% down · 8 years · Delivery 2028\n   ≈ EGP 182,813 quarterly (≈ EGP 60,938 / month) after EGP 650,000 down — smallest unit\n🛠️ Maintenance: 8%\n\nTo ask about it, send: P1 en\n\n👤 Ahmed",
  );
  await b.send(".project 1 en", ME);
  assert.match(b.text(), /^🏗️ \*ماونتن فيو آي سيتي\* — P1\n🏢 Developer/);

  const n = b.sentTo("201055554444@s.whatsapp.net").length;
  await b.send("P9", "201055554444@s.whatsapp.net");
  assert.equal(b.sentTo("201055554444@s.whatsapp.net").length, n, "no such project: nothing");
});

test("the same project asked again within 30 seconds in a chat is answered once; the client menu points to P1", async () => {
  const b = bot();
  await b.send("P1");
  const n = b.sentTo(CLIENT).length;
  await b.send("P1");
  assert.equal(b.sentTo(CLIENT).length, n, "flood limit, like #12");

  re.add(b.app.state, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME);
  await b.send(".agent catalog on", ME);
  const other = "201033332222@s.whatsapp.net";
  await b.send("عقارات", other);
  await b.send("2", other);
  assert.match(b.text(), /للتفاصيل أرسل رقم المشروع \(مثلاً P1\) · 0 للقائمة/);
});
