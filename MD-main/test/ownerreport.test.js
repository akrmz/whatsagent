"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const OWNER = "201001234567@s.whatsapp.net";
const GROUP = "120363000000000011@g.us";
const DAY = 86400 * 1000;
const HOUR = 3600 * 1000;

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
  const send = (text, { from = ME, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `R${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "", sentTo: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test(".listing report: the owner's marketing report, previewed in private, sent once a day, without clients' details", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T09:00:00Z") });
  const b = bot();
  const s = b.s;
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.5 مليون\nالمساحة: 150\nالمالك: أبو أحمد 01001234567"); // #1
  for (const price of [2.7e6, 2.8e6, 2.9e6]) re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price, size: 150 }, ME); // #2–#4: similar, cheaper
  leads.add(s, { name: "منى", phone: "201099998888" }, ME); // #1
  leads.add(s, { name: "كريم", phone: "201077776666" }, ME); // #2
  leads.markSent(s, 1, 1, ME, "أُرسل له العقار #1");
  leads.markSent(s, 2, 1, ME, "أُرسل له العقار #1");
  await b.send(".listing 1", { from: CLIENT }); // a client's view

  viewings.add(s, { lead: 1, listing: 1, at: Date.now() + DAY, chat: ME, by: ME }); // viewing #1
  viewings.add(s, { lead: 2, listing: 1, at: Date.now() + DAY + HOUR, chat: ME, by: ME }); // viewing #2
  t.mock.timers.setTime(Date.now() + DAY + 3 * HOUR);
  await b.send(".viewing done 1 liked عجبها بس شايفة السعر عالي، كلميني 01099998888");
  await b.send(".viewing done 1 thinking السعر عالي شوية"); // recorded again: replaces the first
  await b.send(".viewing done 2 noshow اتصلت بيه على 01077776666 مردش");
  await b.send(".listing edit 1 السعر: 3.2 مليون");
  t.mock.timers.setTime(Date.parse("2026-10-11T10:00:00Z"));

  const before = b.sock.sent.length;
  await b.send(".listing report 1");
  const r = b.text();
  assert.match(r, /^📊 \*Report for the owner of #1\* — preview, not sent yet:\n\nأهلاً أبو أحمد 👋\n📊 تقرير تسويق شقة في التجمع الخامس \(#1\) لحد النهارده:/);
  assert.match(r, /💰 السعر المعروض: 3,200,000 .+ \(بعد التخفيض من 3,500,000 .+\)\n📅 معروض من 10 يوم/);
  assert.match(r, /📣 اتبعت لـ 2 عميل مناسب\n👀 1 مشاهدة\n🏠 المعاينات: 2\n {3}🤔 بيفكر 1 · 🚫 لم يحضر 1/);
  assert.match(r, /💬 آراء اللي عاينوا:\n• اتصلت بيه على \[رقم\] مردش\n• السعر عالي شوية\n/, "one entry per viewing (the latest), newest first, numbers masked");
  assert.match(r, /📈 سعر المتر 21,333 .+ — أعلى من المتوسط بـ 14% \(مقارنة بـ 3 عقار مشابه في المنطقة\)/);
  assert.match(r, /Send it to the owner \(أبو أحمد, \+201001234567\): \.listing report 1 send$/);
  assert.doesNotMatch(r.split("\n\nSend it")[0].replace(/^[\s\S]*?preview, not sent yet:/, ""), /منى|كريم|201099998888|201077776666/, "no client names or numbers");
  assert.equal(b.sock.sent.length, before + 1, "a preview only");

  await b.send(".listing report 1", { chat: GROUP });
  assert.match(b.text(), /private chat with the bot/);
  assert.doesNotMatch(b.text(), /أبو أحمد|201001234567/);
  await b.send(".listing report 1 send", { from: CLIENT });
  assert.equal(b.sentTo(OWNER).length, 0, "clients can't send it");

  const updated = re.get(s, 1).updated;
  await b.send(".listing report 1 send");
  assert.match(b.text(), /📤 Sent the marketing report for #1 to أبو أحمد \(\+201001234567\)\./);
  const toOwner = b.sentTo(OWNER);
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0].content.text, /^أهلاً أبو أحمد 👋\n📊 تقرير تسويق/);
  assert.match(toOwner[0].content.text, /لو فيه أي تغيير في السعر أو الحالة ابعتهولي هنا 🙏/);
  assert.doesNotMatch(toOwner[0].content.text, /منى|كريم|201099998888|201077776666|Send it/);
  assert.equal(re.get(s, 1).updated, updated, "a report isn't an update of the listing");

  await b.send(".listing report 1 send");
  assert.match(b.text(), /already got a report today/);
  assert.equal(b.sentTo(OWNER).length, 1);
  t.mock.timers.setTime(Date.now() + 21 * HOUR);
  await b.send(".listing report 1 ابعت");
  assert.equal(b.sentTo(OWNER).length, 2, "the next day it can go again");
  t.mock.timers.reset();
});

test(".listing report: a new listing with no activity yet, and one without an owner number", async () => {
  const b = bot();
  re.add(b.s, { type: "فيلا", deal: "إيجار", location: "الشيخ زايد", price: 80000 }, ME); // #1
  await b.send(".listing report 1");
  const r = b.text();
  assert.match(r, /أهلاً 👋\n📊 تقرير تسويق فيلا في الشيخ زايد \(#1\)/);
  assert.match(r, /80,000 .+ شهرياً\n📅 معروض من النهارده\n\n📣 لسه بادئين التسويق/);
  assert.doesNotMatch(r, /📈/, "no market comparison for rentals");
  assert.match(r, /To send it, add the owner's number: \.listing edit 1 المالك:/);
  await b.send(".listing report 1 send");
  assert.match(b.text(), /#1 has no owner number/);
  await b.send(".listing report 9");
  assert.match(b.text(), /There is no listing #9/);
});
