"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const compareImage = require("../src/services/compareimage");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي، مراسي", price: 9e6, size: 120, rooms: 2, baths: 2, down: 2e6, years: 5, features: ["صف أول", "فيو بحر", "حمام سباحة"] }, ME); // #1
  re.add(s, { type: "شاليه", deal: "بيع", location: "العين السخنة", price: 4e6, size: 100, rooms: 2, features: ["فيو بحر"] }, ME); // #2
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 6.5e6, size: 110, rooms: 3 }, ME); // #3
  re.add(s, { type: "فيلا", deal: "بيع", location: "زايد", price: 12e6, size: 300 }, ME); // #4
  return { app, sock, send, s, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content || {} };
}

test("the rows: price, size, price per m² (the best marked), rooms, how it's paid, features", () => {
  const b = bot();
  const rows = compareImage.rows([1, 2, 3].map((id) => re.get(b.s, id)), "جنيه");
  const row = (label) => rows.find((r) => r[0] === label);
  assert.deepEqual(row("السعر (جنيه)")[1], ["9,000,000", "4,000,000", "6,500,000"]);
  assert.deepEqual(row("سعر المتر").slice(1), [["75,000", "40,000", "59,091"], 1], "the cheapest per m² is marked");
  assert.deepEqual(row("الغرف")[1], ["2 غرف · 2 حمام", "2 غرف", "3 غرف"]);
  assert.deepEqual(row("الدفع")[1], ["مقدم 2 مليون + 5 سنين", "كاش", "كاش"]);
  assert.deepEqual(row("المميزات")[1], ["صف أول، فيو بحر", "فيو بحر", "—"]);
  assert.deepEqual(rows.find((r) => r[0] === "")[1], ["حمام سباحة", "", ""], "more features on a second line");
});

test(".compare … image: a 1080×1350 picture for 2 or 3 listings; clients get 3 every 10 minutes", async () => {
  const b = bot();
  await b.send(".compare 1 2 3 image");
  const out = b.last();
  const meta = await sharp(out.image).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, "jpeg"]);
  assert.equal(out.caption, "مقارنة #1 · #2 · #3 — للتفاصيل والصور أرسل رقم العقار (مثلاً #1)");
  await b.send(".compare 1 2 3 4 image");
  assert.match(b.last().text, /A picture compares 2 or 3 listings/);
  await b.send(".compare 1 2 3 4");
  assert.ok(b.last().text, "the text version still takes 4");

  for (let i = 0; i < 3; i++) await b.send(".compare 1 2 image", CLIENT);
  assert.ok(b.last(CLIENT).image, "a client can make some");
  await b.send(".compare 1 2 image", CLIENT);
  assert.match(b.last(CLIENT).text, /^You can make 3 comparison pictures every 10 minutes/);
});
