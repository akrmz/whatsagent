"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const rentals = require("../src/services/rentals");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const TENANT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000055@g.us";

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
  re.setAgent(app.state, "name", "أحمد");
  re.add(app.state, { type: "شقة", deal: "إيجار", location: "التجمع الخامس", price: 15000 }, ME); // #1
  return { app, sock, send, s: app.state, last: () => sock.sent.at(-1).content };
}

test(".rental receipt: an image for a recorded payment only, sent to the tenant on request", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-06T10:00:00Z") });
  const b = bot();
  const r = rentals.add(b.s, { listing: 1, tenant: "محمد حسن", phone: "201099998888", rent: 15000, day: 5, start: "2026-01-01" }, ME, "2026-10-06");

  await b.send(`.rental receipt ${r.id}`);
  assert.match(b.last().text, /No payment is recorded for #1\. Record it first: \.rental paid 1/);
  await b.send(`.rental paid ${r.id}`);
  assert.match(b.last().text, /🧾 Receipt: \.rental receipt 1 2026-10 · to the tenant: \.rental receipt 1 2026-10 send/);

  await b.send(`.rental receipt ${r.id}`);
  const shown = b.last();
  assert.deepEqual([shown.image.subarray(0, 2).toString("hex")], ["ffd8"], "a JPEG");
  const meta = await sharp(shown.image).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1350]);
  assert.equal(
    shown.caption,
    "🧾 إيصال استلام إيجار (R1-202610)\nاستلمنا من محمد حسن مبلغ 15,000 جنيه قيمة إيجار شهر أكتوبر 2026\nالوحدة: شقة — التجمع الخامس (#1)\nتاريخ الاستلام: 6 أكتوبر 2026\n\nSend it to the tenant: .rental receipt 1 2026-10 send",
  );
  assert.equal(b.sock.sent.filter((m) => m.jid === TENANT).length, 0, "not sent without 'send'");

  await b.send(`.rental receipt ${r.id} سبتمبر`);
  assert.match(b.last().text, /No payment is recorded for #1 in سبتمبر 2026/, "a month that wasn't paid gets no receipt");

  await b.send(`.rental receipt ${r.id} send`);
  const toTenant = b.sock.sent.filter((m) => m.jid === TENANT).at(-1).content;
  assert.ok(Buffer.isBuffer(toTenant.image));
  assert.match(toTenant.caption, /^🧾 إيصال استلام إيجار \(R1-202610\)[\s\S]*\n\nشكراً لك 🙏$/);
  assert.equal(b.last().text, "📤 Receipt R1-202610 sent to محمد حسن (+201099998888).");

  await b.send(`.rental receipt ${r.id}`, { chat: GROUP });
  assert.match(b.last().text, /^🔒/, "tenants' details: not in a mixed group");
  t.mock.timers.reset();
});

test("a part payment says what is left; no number, no sending", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-06T10:00:00Z") });
  const b = bot();
  const r = rentals.add(b.s, { unit: "محل وسط البلد", tenant: "سعيد", rent: 8000, day: 1, start: "2026-01-01" }, ME, "2026-10-06");
  await b.send(`.rental paid ${r.id} 10 5 الاف`);
  await b.send(`.rental receipt ${r.id} 2026-10`);
  assert.match(b.last().caption, /مبلغ 5,000 جنيه[\s\S]*الوحدة: محل وسط البلد[\s\S]*⚠️ دفعة جزئية — المتبقي 3,000 جنيه/);
  await b.send(`.rental receipt ${r.id} send`);
  assert.match(b.last().text, /#1 has no tenant number/);
  t.mock.timers.reset();
});
