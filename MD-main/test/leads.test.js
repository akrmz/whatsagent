"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const leads = require("../src/services/leads");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const STRANGER = "201099998888@s.whatsapp.net";

test("phone numbers, budgets, client details and contact cards", () => {
  const eg = "201011112222";
  assert.deepEqual(["01001234567", "0100 123 4567", "+20 100 123 4567", "00201001234567", "٠١٠٠١٢٣٤٥٦٧"].map((p) => leads.normalizePhone(p, eg)), Array(5).fill("201001234567"));
  assert.equal(leads.normalizePhone("0501234567", "966501112222"), "966501234567", "local numbers use the owner's country");
  assert.equal(leads.normalizePhone("12345", "966501112222"), null);
  assert.deepEqual(leads.parseBudget("2-3 مليون"), { min: 2e6, max: 3e6 });
  assert.deepEqual(leads.parseBudget("من 2 إلى 3 مليون"), { min: 2e6, max: 3e6 });
  assert.deepEqual(leads.parseBudget("800 ألف - 1.2 مليون"), { min: 8e5, max: 1.2e6 });
  assert.deepEqual(leads.parseBudget("حتى 3 مليون"), { max: 3e6 });
  assert.deepEqual(leads.parseLeadText("الاسم: أحمد محمد\nالموبايل: 0100 123 4567\nالميزانية: 2-3 مليون\nالنوع: شقة\nالمنطقة: التجمع الخامس\nالغرف: 3\nالمصدر: فيسبوك\nعايز تسليم قريب", eg), {
    name: "أحمد محمد", phone: "201001234567", min: 2e6, max: 3e6, type: "شقة", location: "التجمع الخامس", rooms: 3, source: "فيسبوك", notes: "عايز تسليم قريب",
  });
  assert.deepEqual(leads.fromVcard("BEGIN:VCARD\nVERSION:3.0\nFN:Mona Client\nTEL;type=CELL;waid=201112223334:+20 111 222 3334\nEND:VCARD"), { name: "Mona Client", phone: "201112223334" });
});

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  const onWhatsApp = new Map();
  sock.onWhatsApp = async (jid) => [{ jid, exists: onWhatsApp.get(jid) ?? true }];
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const me = "201011112222@s.whatsapp.net";
  const send = (text, from = me, quoted) =>
    d.handleMessage(sock, {
      key: { id: `M${++n}`, remoteJid: from, fromMe: false },
      pushName: "x",
      message: quoted ? { extendedTextMessage: { text, contextInfo: { quotedMessage: quoted, participant: from, stanzaId: "Q" } } } : { conversation: text },
    });
  const last = () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "";
  return { app, sock, send, last, me, onWhatsApp };
}

test("clients from chat: save, match listings both ways, notes, status, follow-up, send a listing, privacy", async () => {
  const b = bot();
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس - كمبوند ميفيدا\nالسعر: 2.8 مليون\nالمساحة: 150\nالغرف: 3");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.2 مليون\nالغرف: 3");
  await b.send(".listing add\nالنوع: فيلا\nللبيع\nالمنطقة: الشيخ زايد\nالسعر: 9 مليون");

  await b.send(".lead add\nالاسم: أحمد محمد\nالموبايل: 0100 123 4567\nالميزانية: 2-3 مليون\nالنوع: شقة\nالمنطقة: التجمع\nالغرف: 3\nالمصدر: فيسبوك");
  assert.match(b.last(), /Client saved as \*#1\*/);
  assert.match(b.last(), /📞 \+201001234567/);
  assert.match(b.last(), /💰 الميزانية: 2 مليون – 3 مليون جنيه/);
  assert.match(b.last(), /عقارات مناسبة \(2\)[\s\S]*#1\*[\s\S]*#2\*.*⚠️ أعلى من الميزانية/, "3.2m is within 10% over the budget, flagged");
  assert.doesNotMatch(b.last(), /#3\* فيلا/);

  await b.send(".lead add\nالموبايل: 01001234567");
  assert.match(b.last(), /already saved as client #1/);

  const card = { contactMessage: { displayName: "Mona", vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Mona Client\nTEL;type=CELL;waid=201112223334:+20 111 222 3334\nEND:VCARD" } };
  await b.send(".lead add", b.me, card);
  assert.match(b.last(), /Client saved as \*#2\*[\s\S]*Mona Client[\s\S]*\+201112223334/, "from a shared contact card");

  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الأول\nالسعر: 2.5 مليون\nالغرف: 3");
  assert.match(b.last(), /🎯 يناسب 1 من عملائك: #1 أحمد محمد/, "a new listing names the clients it suits");
  await b.send(".listing match 4");
  assert.match(b.last(), /Clients for #4[\s\S]*#1\* أحمد محمد/);

  await b.send(".lead note 1 اتصلت به، يفضل دور متوسط");
  await b.send(".lead status 1 معاينة");
  assert.equal(leads.get(b.app.state, 1).status, "viewing");
  await b.send(".lead 1");
  assert.match(b.last(), /👀 معاينة/);
  assert.match(b.last(), /السجل:[\s\S]*يفضل دور متوسط[\s\S]*الحالة: 👀 معاينة/);

  await b.send(".lead follow 1 2h يرد على العرض");
  assert.match(b.last(), /remind you here to follow up with #1/);
  const at = leads.get(b.app.state, 1).followUp.at;
  assert.equal(await leads.runDue(b.app, at - 1000), 0);
  assert.equal(await leads.runDue(b.app, at + 1000), 1);
  assert.match(b.last(), /⏰ \*متابعة العميل #1\* — أحمد محمد \+201001234567\n📝 يرد على العرض/);
  assert.equal(leads.get(b.app.state, 1).followUp, undefined, "sent once");

  await b.send(".lead send 2 1");
  const out = b.sock.sent.at(-2);
  assert.equal(out.jid, "201112223334@s.whatsapp.net");
  assert.match(out.content.text, /^أهلاً Mona Client 👋[\s\S]*شقة للبيع\* — #1/);
  assert.match(b.last(), /Listing #1 sent to #2/);
  assert.equal(leads.get(b.app.state, 2).status, "contacted", "new → contacted after sending");
  b.onWhatsApp.set("201001234567@s.whatsapp.net", false);
  await b.send(".lead send 1 1");
  assert.match(b.last(), /not on WhatsApp/);

  await b.send(".leads");
  assert.match(b.last(), /العملاء \(2\)/);
  assert.match(b.last(), /📞 تم التواصل: 1 · 👀 معاينة: 1/, "the pipeline counts");
  await b.send(".leads viewing");
  assert.match(b.last(), /1 نتيجة:[\s\S]*#1\* أحمد محمد/);
  await b.send(".leads 0111");
  assert.match(b.last(), /#2\* Mona Client/, "search by part of the number");

  const before = b.sock.sent.length;
  await b.send(".lead 1", STRANGER);
  await b.send(".leads", STRANGER);
  assert.ok(b.sock.sent.slice(before).every((s) => !/أحمد محمد|Mona/.test(s.content.text || "")), "clients' details only for owner and sudo");
  await b.send(".listing add\nالنوع: شقة\nالمنطقة: التجمع\nالسعر: 2.6 مليون", STRANGER);
  assert.doesNotMatch(b.last(), /أحمد/);

  await b.send(".lead del 2");
  assert.equal(leads.get(b.app.state, 2), null);
});
