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
const GROUP = "120363000000000012@g.us";

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
  const send = (text, { from = CLIENT, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  const add = (f) => re.add(s, { deal: "بيع", ...f }, ME);
  add({ type: "شقة", location: "التجمع", price: 3.5e6 }); // #1
  add({ type: "شقة", location: "زايد", price: 2.5e6 }); // #2
  add({ type: "شقة", location: "المعادي", price: 3e6 }); // #3
  add({ type: "فيلا", location: "زايد", price: 9e6 }); // #4
  add({ type: "شقة", deal: "إيجار", location: "المعادي", price: 15000 }); // #5
  const sold = add({ type: "محل", location: "التجمع", price: 2e6 }); // #6 sold: not in the menu
  re.update(s, sold.id, { status: "sold" });
  projects.add(s, projects.parseProjectText("المشروع: ماونتن فيو\nالمنطقة: التجمع\nيبدأ من: 6 مليون\nالمقدم: 10%\nالتقسيط: 8 سنوات"), ME);
  return { app, sock, send, s, sentTo: (jid) => sock.sent.filter((m) => m.jid === jid), text: () => sock.sent.at(-1).content.text || "" };
}

test("off by default; on: the menu, a group cheapest first, back to the menu, projects, a wrong number", async () => {
  const b = bot();
  await b.send("عقارات");
  assert.equal(b.sentTo(CLIENT).length, 0, "nothing until .agent catalog on");

  await b.send(".agent catalog on", { from: ME });
  assert.match(b.text(), /catalog: on/);
  await b.send("عقارات");
  assert.equal(b.text(), "🏠 *العقارات المتاحة*\n\n1️⃣ شقق للبيع (3)\n2️⃣ فيلات للبيع (1)\n3️⃣ شقق للإيجار (1)\n4️⃣ 🏗️ مشروعات جديدة بالتقسيط (1)\n\nاكتب رقم القسم اللي يهمك 👇");

  await b.send("١");
  const r = b.text();
  assert.match(r, /^🏠 \*شقق للبيع\* \(3\)\n\n\*#2\* شقة للبيع — زايد[^\n]*\n\*#3\* [^\n]*\n\*#1\* /, "cheapest first");
  assert.match(r, /للتفاصيل والصور أرسل رقم العقار \(مثلاً #2\) · 0 للقائمة$/);
  await b.send("#2");
  assert.match(b.text(), /^🏠 \*شقة للبيع\* — #2/, "#12 still shows the listing");
  await b.send("4");
  assert.match(b.text(), /^🏗️ \*مشروعات جديدة بالتقسيط\* \(1\)\n\n\*P1\* ماونتن فيو/);
  await b.send("9");
  assert.equal(b.text(), "اختار رقم من 1 لـ 4، أو 0 للقائمة.");
  await b.send("0");
  assert.match(b.text(), /^🏠 \*العقارات المتاحة\*/);
});

test("numbers only count with an open menu; groups, staff in groups and floods are ignored; it closes after 10 minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-09T10:00:00Z") });
  const b = bot();
  await b.send(".agent catalog on", { from: ME });
  const other = "201077776666@s.whatsapp.net";
  await b.send("2", { from: other });
  assert.equal(b.sentTo(other).length, 0, "a number without a menu is just a number");
  await b.send("عقارات", { from: other, chat: GROUP });
  assert.equal(b.sentTo(GROUP).length, 0, "private chats only");

  await b.send("menu", { from: other });
  t.mock.timers.setTime(Date.now() + 11 * 60 * 1000);
  const n = b.sentTo(other).length;
  await b.send("1", { from: other });
  assert.equal(b.sentTo(other).length, n, "the menu closed after 10 minutes");

  for (let i = 0; i < 8; i++) await b.send("القائمة", { from: other });
  assert.equal(b.sentTo(other).length, n + 6, "6 menu steps a minute at most");
  t.mock.timers.reset();
});
