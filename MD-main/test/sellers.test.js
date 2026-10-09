"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildContext } = require("../src/core/context");
const re = require("../src/services/realestate");
const sellers = require("../src/services/sellers");
const requests = require("../src/services/requests");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const OWNER = "201088887777@s.whatsapp.net";
const BUYER = "201066665555@s.whatsapp.net";
const GROUP = "120363000000000044@g.us";

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
    d.handleMessage(sock, { key: { id: `S${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "أبو كريم", message: { conversation: text } });
  re.setAgent(app.state, "name", "أحمد");
  return { app, sock, send, s: app.state, last: (jid) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "", to: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test("an owner who wants to sell is asked for the details; texts and photos are collected; the agent adds it as a listing with them as the owner", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T12:00:00+03:00") });
  const b = bot();
  await b.send("عايز أبيع شقتي في التجمع الخامس", { from: OWNER });
  assert.equal(b.to(OWNER).length, 0, "off by default");
  await b.send(".agent sellers on");
  assert.match(b.last(ME), /sellers: on/);

  await b.send("عايز أبيع شقتي في التجمع الخامس", { from: OWNER });
  assert.match(b.last(OWNER), /^أهلاً 👋 تمام، نقدر نسوّق عقارك\.\nابعتلي في رسالة: النوع، المنطقة، المساحة/);
  assert.match(b.last(ME), /^🏷️ \*مالك عايز يبيع\*: أبو كريم \(\+201088887777\)\n"عايز أبيع شقتي في التجمع الخامس"\nالتفاصيل والصور بتتجمع في: \.sellers 1\nhttps:\/\/wa\.me\/201088887777$/);

  await b.send("150 متر 3 غرف الدور 4 سوبر لوكس السعر 3.2 مليون", { from: OWNER });
  assert.match(b.last(OWNER), /^✅ تمام، وصلتني التفاصيل\. أحمد هيراجعها ويتواصل معاك قريب 🙏$/);
  assert.equal(b.last(ME), "🏷️ تفاصيل عرض المالك #1 (+201088887777):\nشقة للبيع · التجمع الخامس · 150 م² · 3 غرف · 3,200,000 جنيه\n\nأضفه للكتالوج: .sellers add 1 · التفاصيل: .sellers 1");
  const owner = b.to(OWNER).length;
  await b.send("وفيها جراج", { from: OWNER });
  assert.equal(b.to(OWNER).length, owner, "more details are added quietly");

  // A photo (straight to the service, with a stubbed download).
  const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#88aacc" } }).jpeg().toBuffer();
  const ctx = buildContext(b.app, b.sock, { key: { id: "PHOTO1", remoteJid: OWNER, fromMe: false }, pushName: "أبو كريم", message: { imageMessage: { mimetype: "image/jpeg", fileLength: jpeg.length } } });
  ctx.download = async () => jpeg;
  assert.equal(await sellers.handle(ctx), true);
  assert.match(b.last(OWNER), /^📸 وصلت/);
  assert.equal(sellers.get(b.s, 1).photos, 1);

  await b.send(".sellers");
  assert.match(b.last(ME), /^🏷️ \*Owners' offers\* \(1\)[\s\S]*▫️ \*#1\* أبو كريم \(\+201088887777\) — شقة للبيع · التجمع الخامس · 150 م² · 3 غرف · 3,200,000 جنيه · 📸 1/);
  await b.send(".sellers 1");
  assert.match(b.last(ME), /What they wrote:\nعايز أبيع شقتي في التجمع الخامس\n150 متر[\s\S]*\nوفيها جراج/);
  await b.send(".sellers", { chat: GROUP });
  assert.match(b.last(GROUP), /^🔒/, "owners' numbers: not in a mixed group");

  await b.send(".sellers add 1");
  assert.match(b.last(ME), /^✅ Offer #1 is now listing \*#1\* with 1 photo\(s\); its owner is saved \(private\)\./);
  const l = re.get(b.s, 1);
  assert.deepEqual([l.type, l.deal, l.location, l.size, l.rooms, l.price, l.owner.phone, l.owner.name], ["شقة", "بيع", "التجمع الخامس", 150, 3, 3.2e6, "201088887777", "أبو كريم"]);
  assert.equal(l.notes, undefined, "their chat doesn't become the public description");
  assert.equal(re.photos(b.app.config, l).length, 1);
  assert.equal(fs.existsSync(sellers.photoFile(b.app.config, 1, 1)), false, "the offer's photo moved to the listing");
  await b.send(".sellers add 1");
  assert.match(b.last(ME), /There is no open offer #1/);
  t.mock.timers.reset();
});

test("renting out, a missing type, dismissing; buyers, staff and groups aren't sellers", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T12:00:00+03:00") });
  const b = bot();
  re.setAgent(b.s, "sellers", "on");
  re.setAgent(b.s, "requests", "on");
  await b.send("عايز أأجر شقتي في المعادي", { from: OWNER });
  assert.match(b.last(ME), /^🏷️ \*مالك عايز يأجّر\*/);
  assert.equal(sellers.get(b.s, 1).deal, "إيجار");
  assert.equal(sellers.get(b.s, 1).fields.type, "شقة", "'شقتي' says it's a flat");

  await b.send("عندي حاجة عايز أبيعها", { from: BUYER });
  await b.send("150 متر", { from: BUYER });
  await b.send(".sellers add 2");
  assert.match(b.last(ME), /What kind of property is it\? \.sellers add 2 النوع: شقة/);
  await b.send(".sellers add 2 النوع: محل\nالمنطقة: وسط البلد\nالسعر: 2 مليون");
  assert.match(b.last(ME), /^✅ Offer #2 is now listing \*#1\*/);
  assert.equal(re.get(b.s, 1).type, "محل");

  await b.send(".sellers del 1");
  assert.match(b.last(ME), /^🗑️ Offer #1 dismissed/);

  const before = sellers.list(b.s, "new").length;
  await b.send("عايز شقة في التجمع ميزانية 3 مليون", { from: "201022221111@s.whatsapp.net" });
  assert.equal(sellers.list(b.s, "new").length, before, "a buyer isn't a seller");
  await b.send("عايز أبيع شقتي", { from: ME });
  await b.send("عايز أبيع شقتي", { chat: GROUP, from: "201033332222@s.whatsapp.net" });
  assert.equal(sellers.list(b.s, "new").length, before, "not staff, not in groups");
  assert.equal(requests.detect("عندي شقة عايز أبيعها"), null, "a seller isn't answered as a buyer either");
  t.mock.timers.reset();
});
