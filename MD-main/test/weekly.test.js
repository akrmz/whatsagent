"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const weekly = require("../src/services/weekly");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`);

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

test("the week in numbers against the week before, from real activity", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-09-28") });
  const b = bot();
  const s = b.s;
  // The week before (26 Sep – 2 Oct): 2 clients from Facebook, 1 listing sent.
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3.2e6 }, ME); // #1
  leads.add(s, { name: "قديم1", phone: "201000000001", source: "فيسبوك" }, ME);
  leads.add(s, { name: "قديم2", phone: "201000000002", source: "فيسبوك" }, ME);
  await b.send(".lead send 1 1");

  // This week (3 – 9 Oct).
  t.mock.timers.setTime(at("2026-10-04"));
  leads.add(s, { name: "منى", phone: "201000000003", source: "فيسبوك" }, ME); // #3
  leads.add(s, { name: "سارة", phone: "201000000004", source: "فيسبوك" }, ME); // #4
  leads.add(s, { name: "أحمد", phone: "201000000005", source: "إحالة" }, ME); // #5
  await b.send(".lead send 3 1");
  await b.send(".lead send 4 1");
  await b.send(".listing edit 1 السعر: 3 مليون"); // a cut
  await b.send(".listing add فيلا للبيع في زايد بسعر 9 مليون"); // #2, new this week
  t.mock.timers.setTime(at("2026-10-05"));
  await b.send("مهتم جداً", "201000000003@s.whatsapp.net"); // a reply
  await b.send(".viewing add 3 1 at 15:00");
  await b.send(".viewing add 4 1 at 16:00");
  t.mock.timers.setTime(at("2026-10-05", "18:00"));
  await b.send(".viewing done 1 liked");
  await b.send(".viewing done 2 noshow");
  t.mock.timers.setTime(at("2026-10-07"));
  await b.send(".lead won 3 #1 3m 2%");

  const now = at("2026-10-10", "08:30");
  const c = weekly.counts(s, now - 7 * 864e5, now);
  assert.deepEqual([c.clients, c.sent, c.replies, c.viewings, c.deals, c.commission, c.listings, c.cuts], [3, 2, 1, 2, 1, 60000, 1, 1]);
  assert.deepEqual(c.outcomes, { liked: 1, thinking: 0, no: 0, noshow: 1 });
  assert.equal(
    weekly.build(s, "Africa/Cairo", now),
    "📊 *ملخص الأسبوع* (3 أكتوبر – 9 أكتوبر)\n👥 عملاء جدد: 3 (+50%) — فيسبوك 2 · إحالة 1\n📤 رسائل للعملاء: 2 (+100%) · 💬 ردود: 1 (جديد)\n👀 معاينات اتحجزت: 2 (جديد) — 👍 1 · 🚫 1\n✅ صفقات: 1 (جديد) · 🧾 عمولة 60,000 جنيه\n🏠 عقارات جديدة: 1 · 📉 تخفيضات: 1",
  );

  // In the morning summary on Saturdays only (10 Oct 2026 is a Saturday).
  assert.match(digest.build(s, "Africa/Cairo", now), /📊 \*ملخص الأسبوع\*/);
  assert.doesNotMatch(digest.build(s, "Africa/Cairo", at("2026-10-09", "08:30")), /ملخص الأسبوع/);
  t.mock.timers.setTime(now);
  await b.send(".weekly");
  assert.match(b.text(), /^📊 \*ملخص الأسبوع\* \(3 أكتوبر – 9 أكتوبر\)/);
  t.mock.timers.reset();
});
