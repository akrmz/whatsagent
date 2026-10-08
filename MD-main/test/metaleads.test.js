"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const csv = require("../src/services/csv");
const metaleads = require("../src/services/metaleads");
const { importCsv } = require("../src/commands/realestate/office");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  return { app, sock, d: createDispatcher(app), s: app.state };
}

/** A file as Meta's Leads Center downloads it: UTF-16 LE with a byte-order mark, tab-separated. */
const metaFile = (rows) => {
  const header = ["id", "created_time", "ad_name", "platform", "full_name", "phone_number", "email", "ما_هي_ميزانيتك؟", "المنطقة_المفضلة؟", "نوع_الوحدة"];
  const text = [header, ...rows].map((r) => r.join("\t")).join("\r\n");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
};
const ROWS = [
  ["l:1", "2026-10-07T10:22:11+0200", "شقق التجمع - أكتوبر", "ig", "منى سمير", "p:+201002223333", "mona@example.com", "من_2_ل_3_مليون", "التجمع_الخامس", "شقة_3_غرف"],
  ["l:2", "2026-10-07T11:00:00+0200", "فيلات زايد", "fb", "أحمد علي", "p:01001234567", "", "10_مليون", "الشيخ_زايد", "فيلا"],
  ["l:3", "2026-10-07T12:00:00+0200", "فيلات زايد", "fb", "", "", "", "", "", ""],
];

test("decoding: UTF-16 with or without a byte-order mark, tabs, semicolons, commas", () => {
  const t = "a\tb\n1\t2\n";
  for (const buf of [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, "utf16le")]), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(t, "utf16le").swap16()]), Buffer.from(t, "utf16le"), Buffer.from(t)]) {
    assert.deepEqual(csv.records(csv.decode(buf)).rows, [{ a: "1", b: "2" }]);
  }
  assert.deepEqual(csv.records("a;b\n1;2").rows, [{ a: "1", b: "2" }]);
  assert.deepEqual(csv.records("a,b\n1,\"2;3\"").rows, [{ a: "1", b: "2;3" }]);
});

test("a Meta row becomes a client: platform, ad, phone without 'p:', and the form's answers", () => {
  const { header, rows } = csv.records(csv.decode(metaFile(ROWS)));
  assert.equal(metaleads.isMeta(header), true);
  assert.equal(metaleads.isMeta(["name", "phone", "budget"]), false);
  assert.deepEqual(metaleads.fromMeta(rows[0], "201011112222"), {
    name: "منى سمير", phone: "201002223333", source: "إنستجرام", campaign: "شقق التجمع - أكتوبر", min: 2e6, max: 3e6, location: "التجمع الخامس", type: "شقة", rooms: 3,
    notes: "ما هي ميزانيتك: من 2 ل 3 مليون\nالمنطقة المفضلة: التجمع الخامس\nنوع الوحدة: شقة 3 غرف\nemail: mona@example.com\nتاريخ الطلب: 2026-10-07",
  });
  const two = metaleads.fromMeta(rows[1], "201011112222");
  assert.deepEqual([two.source, two.phone, two.max, two.type, two.location], ["فيسبوك", "201001234567", 1e7, "فيلا", "الشيخ زايد"], "a local number takes the owner's country code");
});

test(".import leads on a Meta file: added, duplicates and empty rows skipped, matches counted; .restats by ad", async () => {
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 2.8e6, rooms: 3 }, ME);
  leads.add(b.s, { name: "أحمد", phone: "201001234567" }, ME); // already a client
  const r = importCsv(b.s, csv.decode(metaFile(ROWS)), "leads", { by: ME, ownerNumber: "201011112222" });
  assert.equal(r.meta, true);
  assert.equal(r.added, 1);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped[0], /^3: This number is already saved as client #1/);
  assert.match(r.skipped[1], /^4: Give at least the client's name or phone/);

  const mona = leads.get(b.s, r.ids[0]);
  assert.match(leads.card(mona), /📣 المصدر: إنستجرام — إعلان: شقق التجمع - أكتوبر/);

  // The command: reply to the file with .import leads.
  const cmd = b.app.commands.byName.get("import");
  b.app.commands.byName.set("import", { ...cmd, run: (ctx) => cmd.run({ ...ctx, findMedia: () => ({ type: "document", mimetype: "text/csv", content: { fileName: "leads.csv" } }), download: async () => metaFile([["l:9", "2026-10-07", "شقق التجمع - أكتوبر", "fb", "سارة", "p:+201005556666", "", "3_مليون", "التجمع", "شقة"]]) }) });
  await b.d.handleMessage(b.sock, { key: { id: "M1", remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: ".import leads" } });
  assert.match(b.sock.sent.at(-1).content.text, /^📥 Imported \*1\* client\(s\) from Facebook\/Instagram lead ads of 1\.\n🎯 1 of them already have matching listings — \.leads hot/);

  leads.update(b.s, mona.id, { status: "won" });
  await b.d.handleMessage(b.sock, { key: { id: "M2", remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: ".restats" } });
  assert.match(b.sock.sent.at(-1).content.text, /📢 \*حسب الإعلان\* \(1\)\n▫️ شقق التجمع - أكتوبر: 2 عميل · ✅ 1 صفقة \(50%\)/);
});
