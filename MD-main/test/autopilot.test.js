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
const CLIENT = "201099998888@s.whatsapp.net";
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `P${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

test(".autopilot: everything off at first, then what's on, today's count, running and waiting campaigns, what is due", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-09", "11:00") });
  const b = bot();
  await b.send(".autopilot");
  let r = b.text();
  assert.match(r, /^🤖 \*الأتمتة — كل اللي البوت بيعمله لوحده\*/);
  assert.match(r, /⬜ حفظ اللي يسأل عن #رقم كعميل — \.agent autoleads on\|off/);
  assert.match(r, /📣 رسائل الحملات النهارده: 0 من 40 · 10:00–21:00/);
  assert.match(r, / {3}لا توجد حملات جارية/);

  await b.send(".agent autoleads on");
  await b.send(".agent autoblast on");
  await b.send(".greet on أهلاً بك 🏡 أرسل #رقم العقار لتفاصيله");
  await b.send(".statuspost daily 09:00");
  await b.send(".digest on 08:30");
  leads.add(b.s, { name: "أحمد", phone: "201001110001", type: "شقة", location: "التجمع", max: 3.5e6 }, ME); // not welcomed yet
  await b.send(".listing add شقة للبيع في التجمع الخامس بسعر 3 مليون"); // queues a campaign for 11:30
  const first = re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.9e6 }, ME);
  campaigns.start(b.s, first, { by: ME, chat: ME }); // a running one
  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "11:01"), () => 0), "sent");

  await b.send(".autopilot");
  r = b.text();
  assert.match(r, /✅ حفظ اللي يسأل عن #رقم كعميل/);
  assert.match(r, /✅ ترحيب بأول تواصل/);
  assert.match(r, /✅ حملة تلقائية لكل عقار جديد/);
  assert.match(r, /👋 عملاء جدد بدون ترحيب: 0/, "Ahmed was sent a listing, so he isn't 'new' any more");
  assert.match(r, /📣 رسائل الحملات النهارده: 1 من 40/);
  assert.match(r, /🕒 📣 حملة #1 للعقار #1: ✅ 0 أُرسلت من 1 — يبدأ 11:30/);
  assert.match(r, /✅ الحالة اليومية 09:00/);
  assert.match(r, /✅ ملخص الصباح 08:30/);
  await b.send(".autopilot", CLIENT);
  assert.doesNotMatch(b.text(), /الأتمتة/, "owner and sudo only");
  t.mock.timers.reset();
});
