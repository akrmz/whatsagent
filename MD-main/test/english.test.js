"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const en = require("../src/services/english");
const img = require("../src/services/reimages");
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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `E${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: () => sock.sent.at(-1).content, text: () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "" };
}

const FLAT = { type: "شقة", deal: "بيع", location: "التجمع الخامس، النرجس", price: 3.5e6, size: 150, rooms: 3, baths: 2, floor: "الرابع", finishing: "سوبر لوكس", notes: "فيو مفتوح" };

test("translations: types, floors, finishing, areas, currency", () => {
  assert.deepEqual(["الرابع", "3", "الأرضي", "الأخير", "11", "22", "مختلط"].map(en.floorEn), ["4th floor", "3rd floor", "Ground floor", "Top floor", "11th floor", "22nd floor", null]);
  assert.equal(en.locationEn({ location: "التجمع الخامس، النرجس" }), "Fifth Settlement, New Cairo — El Narges");
  assert.equal(en.locationEn({ location: "الشيخ زايد" }), "Sheikh Zayed", "'زايد' isn't matched a second time");
  assert.equal(en.locationEn({ location: "قرية صغيرة" }), null, "unknown areas aren't guessed");
  assert.equal(en.locationEn({ location: "كمبوند ميفيدا", locationEn: "Mivida, New Cairo" }), "Mivida, New Cairo");
  assert.equal(en.finishingEn("ألترا سوبر لوكس"), "Ultra super lux");
  assert.equal(en.finishingEn("نص تشطيب"), "Semi-finished");
  assert.equal(en.currencyEn("درهم"), "AED");
  assert.equal(re.parseListingText("النوع: شقة\nLocation EN: Mivida, New Cairo").locationEn, "Mivida, New Cairo");
});

test("the English card; Arabic notes are left out, English ones kept; discount and status", () => {
  const a = { name: "Ahmed", phone: "+20 100 123 4567", currency: "جنيه" };
  const c = en.card({ id: 12, status: "available", ...FLAT }, a);
  assert.equal(
    c,
    "🏠 *Apartment for sale* — #12\n📍 Fifth Settlement, New Cairo — El Narges\n💰 *EGP 3,500,000* (EGP 3.5M)\n150 m²  •  3 beds  •  2 baths  •  Super lux  •  4th floor\n💵 EGP 23,333 per m²\n🔖 Available\n\nTo ask about it, send: #12 en\n\n👤 Ahmed · 📞 +20 100 123 4567",
  );
  const rent = en.card({ id: 3, type: "فيلا", deal: "إيجار", price: 50000, notes: "Private pool", status: "rented" }, {});
  assert.match(rent, /^🏠 \*Villa for rent\* — #3\n💰 \*EGP 50,000 \/ month\*/);
  assert.match(rent, /📝 Private pool\n🔖 Rented/);
  const cut = en.card({ id: 4, status: "available", ...FLAT, priceHistory: [{ price: 4e6, at: Date.now() - 1000 }] }, {});
  assert.match(cut, /📉 Was EGP 4,000,000 — 13% off/);
});

test(".listing 12 en, #12 en, .flyer 12 en and .story 12 en", async () => {
  const b = bot();
  re.add(b.s, FLAT, ME);
  await b.send(".listing 1 en", CLIENT);
  assert.match(b.text(), /^🏠 \*Apartment for sale\* — #1/);
  await b.send("#1 en", CLIENT);
  assert.match(b.text(), /^🏠 \*Apartment for sale\* — #1/);
  await b.send("#1", "201077776666@s.whatsapp.net");
  assert.match(b.text(), /^🏠 \*شقة للبيع\*/, "plain #1 stays Arabic");
  await b.send(".flyer 1 en");
  assert.match(b.last().caption, /Apartment for sale/);
  assert.deepEqual([(await sharp(b.last().image).metadata()).width, (await sharp(b.last().image).metadata()).height], [1080, 1350]);
  await b.send(".story 1 en");
  assert.equal(b.last().caption, "#1 — for WhatsApp status");
  assert.equal((await sharp(b.last().image).metadata()).height, 1920);
});

test("English designs put the text on the left; Arabic on the right", async () => {
  // Where the title's ink is: the left half for English, the right half for Arabic.
  const inkSide = async (buf, top, height) => {
    const { data, info } = await sharp(buf).extract({ left: 0, top, width: 1080, height }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let left = 0;
    let right = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] > 200) (x < 540 ? left++ : right++);
    return left > right ? "left" : "right";
  };
  const l = { id: 7, status: "available", ...FLAT };
  assert.equal(await inkSide(await img.flyer(l, {}, null, { lang: "en" }), 1350 - 530 + 40, 70), "left");
  assert.equal(await inkSide(await img.flyer(l, {}, null), 1350 - 530 + 40, 70), "right");
});
