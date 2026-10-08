"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
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
  const send = (text, from = CLIENT) => d.handleMessage(sock, { key: { id: `A${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  re.setAgent(app.state, "catalog", "on");
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "" };
}

test("a big group asks for the area first; a small one opens directly; 'other areas' gathers the rest", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T10:00:00Z") });
  const b = bot();
  const flat = (location, price) => re.add(b.s, { type: "شقة", deal: "بيع", location, price }, ME);
  for (let i = 0; i < 6; i++) flat(i % 2 ? "التجمع الخامس، النرجس" : "التجمع الخامس", 3e6 + i * 1e5); // #1–#6
  for (let i = 0; i < 4; i++) flat("الشيخ زايد - الحي الثامن", 2e6 + i * 1e5); // #7–#10
  flat("المعادي", 4e6); // #11
  flat("المعادي", 3.9e6); // #12
  re.add(b.s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", price: 9e6 }, ME); // #13

  await b.send("عقارات");
  assert.match(b.text(), /1️⃣ شقق للبيع \(12\)\n2️⃣ فيلات للبيع \(1\)/);
  await b.send("1");
  assert.equal(b.text(), "🏠 *شقق للبيع* (12) — اختار المنطقة:\n\n1️⃣ التجمع الخامس (6)\n2️⃣ الشيخ زايد (4)\n3️⃣ المعادي (2)\n\nاكتب رقم المنطقة · 0 للقائمة");
  await b.send("2");
  const zayed = b.text();
  assert.match(zayed, /^🏠 \*شقق للبيع — الشيخ زايد\* \(4\)\n\n\*#7\* /, "cheapest first");
  assert.deepEqual([...zayed.matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1])), [7, 8, 9, 10]);
  assert.match(zayed, /رقم تاني لمنطقة تانية · 0 للقائمة$/);
  await b.send("3");
  assert.deepEqual([...b.text().matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1])), [12, 11], "another area, from the same list");
  await b.send("7");
  assert.equal(b.text(), "اختار رقم من 1 لـ 3، أو 0 للقائمة.");
  t.mock.timers.setTime(Date.now() + 61 * 1000); // 6 steps a minute per client
  await b.send("0");
  await b.send("2");
  assert.match(b.text(), /^🏠 \*فيلات للبيع\* \(1\)\n\n\*#13\*/, "a small group opens directly");

  // Eleven areas: the 8 largest by name, the rest together.
  t.mock.timers.setTime(Date.now() + 2 * 60 * 1000); // past the per-minute menu limit
  const areas = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز"];
  areas.forEach((a, i) => re.add(b.s, { type: "شاليه", deal: "بيع", location: `منطقة ${a}`, price: 1e6 + i }, ME));
  await b.send("القائمة");
  const i = b.text().split("\n").findIndex((l) => l.includes("شاليهات للبيع (11)"));
  await b.send(String(i - 1));
  assert.match(b.text(), /9️⃣ مناطق أخرى \(3\)/);
  await b.send("9");
  assert.match(b.text(), /^🏠 \*شاليهات للبيع — مناطق أخرى\* \(3\)/);
  t.mock.timers.reset();
});
