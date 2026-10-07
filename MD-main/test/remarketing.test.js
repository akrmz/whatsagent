"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const leads = require("../src/services/leads");
const re = require("../src/services/realestate");
const autolistings = require("../src/services/autolistings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = from, name = "Mona" } = {}) =>
    d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: name, message: { conversation: text } });
  const last = () => sock.sent.at(-1).content;
  return { app, sock, send, last };
}

async function withListings(b) {
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3 مليون\nالمساحة: 150\nالغرف: 3\nملاحظات: فيو مفتوح, قريبة من \"الجامعة\"");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الأول\nالسعر: 2.4 مليون\nالمساحة: 120");
  await b.send(".listing add\nالنوع: فيلا\nللبيع\nالمنطقة: الشيخ زايد\nالسعر: 12 مليون\nالمساحة: 400");
  await b.send(".listing add\nالنوع: شقة\nللإيجار\nالمنطقة: المعادي\nالسعر: 25 ألف\nالمساحة: 140");
}

test('"#12" shows the listing in any chat; a note saved as "12" still wins', async () => {
  const b = bot();
  await withListings(b);
  await b.send("#2", { from: CLIENT, chat: GROUP });
  assert.match(b.last().text, /شقة للبيع\* — #2/);
  await b.send("#٣", { from: CLIENT, chat: GROUP });
  assert.match(b.last().text, /فيلا للبيع\* — #3/, "Arabic digits");
  const before = b.sock.sent.length;
  await b.send("#99", { from: CLIENT, chat: GROUP });
  assert.equal(b.sock.sent.length, before, "no such listing: silent");
  await b.send(".save 2 Our office hours are 10-6", { chat: GROUP }); // notes belong to a chat
  await b.send("#2", { from: CLIENT, chat: GROUP });
  assert.equal(b.last().text, "Our office hours are 10-6");
});

test("autoleads: a private question about a listing becomes a client, once, and the owner is told", async () => {
  const b = bot();
  await withListings(b);
  await b.send("#4", { from: CLIENT }); // (not #1: the same listing again within 30 s would be skipped as a repeat)
  assert.equal(leads.all(b.app.state).length, 0, "off by default");

  await b.send(".agent autoleads on");
  await b.send("#1", { from: CLIENT, name: "Mona" });
  const [lead] = leads.all(b.app.state);
  assert.deepEqual([lead.name, lead.phone, lead.type, lead.deal, lead.source], ["Mona", "201099998888", "شقة", "بيع", "واتساب"]);
  assert.match(lead.history[0].text, /سأل عن العقار #1 \(شقة — التجمع الخامس\)/);
  const notice = b.sock.sent.find((s) => s.jid === ME && /🔔/.test(s.content.text || ""));
  assert.match(notice.content.text, /🔔 عميل جديد: Mona \(\+201099998888\) سأل عن #1\n\.lead 1/);

  await b.send("#3", { from: CLIENT });
  assert.equal(leads.all(b.app.state).length, 1, "the same person isn't saved twice");
  assert.match(leads.get(b.app.state, 1).history.at(-1).text, /#3/);
  await b.send("#2", { from: CLIENT, chat: GROUP });
  assert.equal(leads.get(b.app.state, 1).history.length, 2, "questions in groups aren't captured");
  await b.send("#2");
  assert.equal(leads.all(b.app.state).length, 1, "the owner asking isn't a client");
});

test("listing of the day: once a day, rotating, only available ones, optional search", async () => {
  const b = bot();
  await withListings(b);
  await b.send(".listing status 2 reserved");
  await b.send(".autolistings on 10:00 شقة للبيع", { chat: GROUP });
  assert.match(b.last().text, /every day at 10:00 \(only "شقة للبيع"\)\. First: #1/);
  const day = (d, hhmm) => Date.parse(`2026-10-${d}T${hhmm}:00+03:00`);
  assert.equal(await autolistings.runDue(b.app, day("08", "09:59")), 0);
  assert.equal(await autolistings.runDue(b.app, day("08", "10:01")), 1);
  assert.match(b.last().caption, /^🏡 \*عقار اليوم\*[\s\S]*#1[\s\S]*للاستفسار أرسل: #1/);
  assert.ok(b.last().image.length > 1000, "with the flyer");
  assert.equal(await autolistings.runDue(b.app, day("08", "11:00")), 0, "once a day");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: أكتوبر\nالسعر: 1.9 مليون", { chat: ME });
  assert.equal(await autolistings.runDue(b.app, day("09", "10:05")), 1);
  assert.match(b.last().caption, /#5/, "#2 is reserved, #3 is a villa, #4 for rent: next is #5");
  assert.equal(await autolistings.runDue(b.app, day("10", "10:05")), 1);
  assert.match(b.last().caption, /#1/, "round again");
  await b.send(".autos", { chat: GROUP });
  assert.match(b.last().text, /عقار اليوم الساعة 10:00 \(شقة للبيع\)/);
});

test("brochure PDF, CSV export for Excel, and price statistics", async () => {
  const b = bot();
  await withListings(b);
  await b.send(".brochure شقة");
  const doc = b.last();
  assert.equal(doc.mimetype, "application/pdf");
  assert.match(doc.document.toString("latin1"), /\/Count 3/, "one page per matching available listing");

  await b.send(".export listings");
  const listingsCsv = b.last().document.toString("utf8");
  assert.equal(listingsCsv.charCodeAt(0), 0xfeff, "BOM so Excel reads UTF-8");
  assert.match(listingsCsv, /^\uFEFFid,type,deal,location,price,size_m2,price_per_m2/);
  assert.match(listingsCsv, /1,شقة,بيع,التجمع الخامس,3000000,150,20000,3,/);
  assert.match(listingsCsv, /"فيو مفتوح, قريبة من ""الجامعة"""/, "commas and quotes are quoted");
  await b.send(".lead add\nالاسم: أحمد\nالموبايل: 01001234567\nالميزانية: 2-3 مليون");
  await b.send(".export leads");
  assert.match(b.last().document.toString("utf8"), /1,أحمد,\+201001234567,new,,,,,2000000,3000000/);
  await b.send(".export leads", { from: CLIENT });
  assert.ok(!b.last().document, "clients' data only for owner and sudo");

  await b.send(".market التجمع");
  assert.match(b.last().text, /\(2 عقار للبيع من الكتالوج\)[\s\S]*متوسط: \*20,000 جنيه\*\/م² · الوسيط: 20,000 جنيه/);
  await b.send(".market");
  assert.match(b.last().text, /3 عقار للبيع/, "rent listings are left out");
  assert.match(b.last().text, /▫️ شقة: 20,000 جنيه\/م² \(2\)/);
  assert.equal(re.all(b.app.state).length, 4);
});
