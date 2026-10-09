"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const marketImage = require("../src/services/marketimage");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";

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
  const send = (text) => d.handleMessage(sock, { key: { id: `K${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  const add = (type, location, price, size, deal = "بيع") => re.add(s, { type, deal, location, price, size }, ME);
  add("شقة", "التجمع الخامس، النرجس", 3.5e6, 150);
  add("شقة", "التجمع الخامس", 4.2e6, 170);
  add("شقة", "الشيخ زايد", 2.8e6, 140);
  add("شقة", "الشيخ زايد", 3.0e6, 150);
  add("شقة", "المعادي", 4.5e6, 160); // only one in this area: left out
  add("فيلا", "الشيخ زايد", 9e6, 300);
  add("فيلا", "الشيخ زايد", 11e6, 350);
  add("شاليه", "الساحل الشمالي، مراسي", 8e6, 120);
  add("شاليه", "الساحل الشمالي", 6e6, 110);
  add("شقة", "المعادي", 15000, 120, "إيجار");
  add("شقة", "المعادي", 17000, 130, "إيجار");
  return { app, sock, send, s };
}

test("one chart per unit type: apartments, villas and chalets apart, sale and rent apart, at least 2 listings per area", () => {
  const b = bot();
  const { rent, charts } = marketImage.charts(b.s, "");
  assert.equal(rent, false);
  assert.deepEqual(
    charts.map((c) => [c.type, c.bars.map((x) => [x.label, x.median, x.count])]),
    [
      ["شقة", [["التجمع الخامس", 24020, 2], ["الشيخ زايد", 20000, 2]]],
      ["شاليه", [["الساحل الشمالي", 60606, 2]]],
      ["فيلا", [["الشيخ زايد", 30714, 2]]],
    ],
    "the single Maadi apartment and the rentals are left out; highest price first",
  );
  assert.deepEqual(marketImage.charts(b.s, "شاليه").charts.map((c) => c.type), ["شاليه"]);
  const rents = marketImage.charts(b.s, "إيجار");
  assert.equal(rents.rent, true);
  assert.deepEqual(rents.charts.map((c) => [c.type, c.bars.map((x) => [x.label, x.median])]), [["شقة", [["المعادي", 128]]]]);
  assert.deepEqual([marketImage.offers(1), marketImage.offers(2), marketImage.offers(3), marketImage.offers(11)], ["عرض واحد", "عرضين", "3 عروض", "11 عرض"]);
});

test(".market image sends a 1080×1350 picture per type with the figures as its caption", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T12:00:00+03:00") });
  const b = bot();
  await b.send(".market image");
  const pics = b.sock.sent.filter((m) => m.content.image);
  assert.equal(pics.length, 3);
  const meta = await sharp(pics[0].content.image).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, "jpeg"]);
  assert.equal(pics[0].content.caption, "📊 أسعار المتر — الشقق — أكتوبر 2026\n▫️ التجمع الخامس: 24,020 جنيه (عرضين)\n▫️ الشيخ زايد: 20,000 جنيه (عرضين)\n\nللاسترشاد من عروض الكتالوج، مش تقييم رسمي.");
  assert.match(pics[1].content.caption, /^📊 أسعار المتر — الشاليهات/);
  assert.match(pics[2].content.caption, /^📊 أسعار المتر — الفيلات/);

  await b.send(".market image إيجار");
  assert.match(b.sock.sent.at(-1).content.caption, /^📊 إيجار المتر شهرياً — الشقق — أكتوبر 2026\n▫️ المعادي: 128 جنيه شهرياً \(عرضين\)/);
  await b.send(".market image مارينا");
  assert.match(b.sock.sent.at(-1).content.text, /^Not enough figures for a picture yet/);
  t.mock.timers.reset();
});
