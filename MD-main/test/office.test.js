"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const csv = require("../src/services/csv");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const digest = require("../src/services/digest");
const { importCsv } = require("../src/commands/realestate/office");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const TEAM = "201033334444@s.whatsapp.net";
const BOM = String.fromCharCode(0xfeff);

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
  const send = (text, { from = ME, mentions } = {}) =>
    d.handleMessage(sock, {
      key: { id: `M${++n}`, remoteJid: from, fromMe: false },
      pushName: "x",
      message: mentions ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } } : { conversation: text },
    });
  const last = () => sock.sent.at(-1).content;
  return { app, sock, send, last };
}

test("CSV reader: quotes, line breaks in cells, Excel's BOM, ';' separators", () => {
  assert.deepEqual(csv.parse(`${BOM}id,notes\r\n1,"view, near ""uni"""\r\n2,"line1\nline2"\r\n\r\n`), [["id", "notes"], ["1", 'view, near "uni"'], ["2", "line1\nline2"]]);
  assert.deepEqual(csv.parse("النوع;السعر\nشقة;3,500,000\n"), [["النوع", "السعر"], ["شقة", "3,500,000"]], "the comma in the price stays");
  assert.deepEqual(csv.records("Type,Size m2\nشقة,150").rows, [{ type: "شقة", size_m2: "150" }]);
});

test("export → import round trip for listings and clients; re-importing skips duplicates", async () => {
  const a = bot();
  await a.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3 مليون\nالمساحة: 150\nالغرف: 3\nملاحظات: فيو مفتوح, قريبة من \"الجامعة\"");
  await a.send(".listing add\nالنوع: فيلا\nللإيجار\nالمنطقة: الشيخ زايد\nالسعر: 85 ألف\nالمساحة: 400");
  await a.send(".listing status 2 rented");
  await a.send(".export listings");
  const listingsCsv = a.last().document.toString("utf8");
  await a.send(".lead add\nالاسم: أحمد\nالموبايل: 01001234567\nالميزانية: 2-3 مليون\nالنوع: شقة\nالمنطقة: التجمع");
  await a.send(".lead status 1 viewing");
  await a.send(".export leads");
  const leadsCsv = a.last().document.toString("utf8");

  const b = bot();
  const r1 = importCsv(b.app.state, listingsCsv, "listings", { by: ME, ownerNumber: "201011112222" });
  assert.deepEqual([r1.added, r1.total, r1.skipped], [2, 2, []]);
  const [one, two] = [re.get(b.app.state, 1), re.get(b.app.state, 2)];
  assert.deepEqual([one.type, one.deal, one.location, one.price, one.size, one.rooms], ["شقة", "بيع", "التجمع الخامس", 3e6, 150, 3]);
  assert.match(one.notes, /فيو مفتوح, قريبة من "الجامعة"/);
  assert.deepEqual([two.type, two.deal, two.price, two.status], ["فيلا", "إيجار", 85000, "rented"]);
  const r2 = importCsv(b.app.state, listingsCsv, "listings", { by: ME, ownerNumber: "201011112222" });
  assert.deepEqual([r2.added, r2.skipped], [0, ["2: same as #1", "3: same as #2"]]);

  const r3 = importCsv(b.app.state, leadsCsv, "leads", { by: ME, ownerNumber: "201011112222" });
  assert.equal(r3.added, 1);
  const l = leads.get(b.app.state, 1);
  assert.deepEqual([l.name, l.phone, l.min, l.max, l.status, l.type], ["أحمد", "201001234567", 2e6, 3e6, "viewing", "شقة"]);
  assert.match(importCsv(b.app.state, leadsCsv, "leads", { by: ME, ownerNumber: "201011112222" }).skipped[0], /^2: This number is already saved as client #1/);
});

test("importing a sheet with Arabic headers and ';' separators", () => {
  const b = bot();
  const sheet = "النوع;الغرض;المنطقة;السعر;المساحة;الغرف;الحالة\nشقة;للبيع;المعادي;2,400,000;120;2;متاح\nمحل;للإيجار;وسط البلد;15000;40;;محجوز\n;;;;;;\n";
  const r = importCsv(b.app.state, sheet, "listings", { by: ME, ownerNumber: "201011112222" });
  assert.equal(r.added, 2);
  assert.deepEqual([re.get(b.app.state, 1).price, re.get(b.app.state, 1).rooms], [2400000, 2]);
  assert.deepEqual([re.get(b.app.state, 2).type, re.get(b.app.state, 2).deal, re.get(b.app.state, 2).status], ["محل", "إيجار", "reserved"]);
  // A row of empty cells is ignored; a row with only a note can't be a property.
  const bad = importCsv(b.app.state, "النوع,السعر,ملاحظات\n,,\nشقة,1.5m,\n,,just a note\n", "listings", { by: ME, ownerNumber: "201011112222" });
  assert.equal(bad.added, 1);
  assert.match(bad.skipped.join(), /^4: I couldn't read the property/, "row numbers as in the spreadsheet (empty row 2 isn't counted as data)");
});

test("a listing that looks already saved gets a warning", async () => {
  const b = bot();
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3 مليون\nالمساحة: 150");
  await b.send(".listing add\nشقة للبيع\nالمنطقة: التجمع  الخامس\nالسعر: 3,000,000\nالمساحة: 150");
  assert.match(b.last().text, /⚠️ This looks like #1, already saved\. If it's the same property: \.listing del 2/);
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3 مليون\nالمساحة: 160");
  assert.doesNotMatch(b.last().text, /looks like/, "a different size is a different flat");
});

test("team: assign clients to the owner or sudo users, list mine, mention them in follow-ups", async () => {
  const b = bot();
  await b.send(".lead add\nالاسم: أحمد\nالموبايل: 01001234567\nالنوع: شقة");
  await b.send(".lead add\nالاسم: منى\nالموبايل: 01112223334\nالنوع: فيلا");
  await b.send(".lead assign 1 @someone", { mentions: [TEAM] });
  assert.match(b.last().text, /owner or a sudo user/);
  await b.send(`.sudo add ${TEAM.split("@")[0]}`);
  await b.send(".lead assign 1 @member", { mentions: [TEAM] });
  assert.match(b.last().text, /assigned to @201033334444/);
  assert.deepEqual(b.last().mentions, [TEAM]);
  await b.send(".lead assign 2 me");
  await b.send(".leads mine");
  assert.match(b.last().text, /1 نتيجة:[\s\S]*#2\* منى/);
  await b.send(".leads mine", { from: TEAM });
  assert.match(b.last().text, /1 نتيجة:[\s\S]*#1\* أحمد/);
  await b.send(".lead 1");
  assert.match(b.last().text, /🧑‍💼 المسؤول: @201033334444/);

  await b.send(".lead follow 1 1h");
  await leads.runDue(b.app, Date.now() + 2 * 3600 * 1000);
  assert.deepEqual(new Set(b.last().mentions), new Set([ME, TEAM]), "the one who set it and the assignee");
});

test("daily summary: today's viewings and follow-ups, new and quiet clients, the catalogue; once a day", async () => {
  const b = bot();
  const s = b.app.state;
  const now = Date.parse("2026-10-08T06:00:00+03:00");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع\nالسعر: 3 مليون");
  await b.send(".listing add\nالنوع: فيلا\nللبيع\nالمنطقة: زايد\nالسعر: 9 مليون");
  await b.send(".listing status 2 reserved");
  const ahmed = leads.add(s, { name: "أحمد", phone: "201001234567", type: "شقة" }, ME, now - 3600e3);
  const mona = leads.add(s, { name: "منى", phone: "201112223334", type: "شقة" }, ME, now - 10 * 86400e3);
  leads.update(s, mona.id, { status: "contacted" }, now - 10 * 86400e3);
  viewings.add(s, { lead: ahmed.id, listing: 1, at: Date.parse("2026-10-08T16:00:00+03:00"), chat: ME, by: ME }, now);
  leads.setFollowUp(s, ahmed.id, { at: Date.parse("2026-10-08T11:00:00+03:00"), chat: ME, by: ME, note: "يرد على العرض" });

  const text = digest.build(s, "Africa/Cairo", now);
  assert.match(text, /📋 \*ملخص اليوم\* — 2026-10-08/);
  assert.match(text, /المعاينات اليوم \(1\)\*\n🗓️ \*#1\*.*مع أحمد/);
  assert.match(text, /متابعات اليوم \(1\)\*\n11:00 \*#1\* أحمد.*— يرد على العرض/);
  assert.match(text, /عملاء جدد آخر 24 ساعة \(1\)/);
  assert.match(text, /بدون تواصل منذ 7\+ أيام \(1\)\*\n\*#2\* منى.*منذ 10 يوم/);
  assert.match(text, /الكتالوج: ✅ 1 متاح · ⏳ 1 محجوز · 🔴 0/);

  await b.send(".digest on 08:30");
  assert.equal(await digest.runDue(b.app, Date.parse("2026-10-08T08:29:00+03:00")), 0);
  assert.equal(await digest.runDue(b.app, Date.parse("2026-10-08T08:31:00+03:00")), 1);
  assert.equal(await digest.runDue(b.app, Date.parse("2026-10-08T09:00:00+03:00")), 0, "once a day");
  await b.send(".autos");
  assert.match(b.last().text, /ملخص اليوم الساعة 08:30/);
});
