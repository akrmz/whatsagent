"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const MIN = 60 * 1000;
const T0 = Date.parse("2026-10-09T08:00:00Z"); // 11:00 in Cairo
const ADD = ".listing add شقة للبيع في التجمع الخامس 150 متر بسعر 3 مليون";

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
  const send = (text, message) => d.handleMessage(sock, { key: { id: `A${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: message || { conversation: text } });
  leads.add(app.state, { name: "أحمد", phone: "201001110001", type: "شقة", location: "التجمع", max: 3.5e6 }, ME);
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "", toClient: () => sock.sent.filter((m) => m.jid === "201001110001@s.whatsapp.net") };
}

test("off by default; on: a new matching listing becomes a campaign that waits 30 minutes, then sends (with photos added meanwhile)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const b = bot();
  await b.send(ADD);
  assert.doesNotMatch(b.text(), /📣 Campaign/);
  assert.equal(campaigns.all(b.s).length, 0);

  await b.send(".agent autoblast on");
  assert.match(b.text(), /autoblast: on/);
  await b.send(ADD.replace("3 مليون", "3.2 مليون"));
  assert.match(b.text(), /📣 Campaign #1: it goes to 1 matching client\(s\) from 11:30 \(add photos before then\)\. Cancel: \.blast stop 1/);
  await b.send(".campaigns");
  assert.match(b.text(), /▶️ جارية 📣 حملة #1 للعقار #2: ✅ 0 أُرسلت من 1 · ⏳ 1 متبقي · 🕒 يبدأ 11:30/);

  assert.equal(await campaigns.tick(b.app, T0 + 10 * MIN, () => 0), "idle", "not before 30 minutes");
  const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 50, b: 50 } } }).jpeg().toBuffer();
  re.addPhoto(b.s, b.app.config, 2, jpeg); // a photo added in the meantime
  assert.equal(await campaigns.tick(b.app, T0 + 31 * MIN, () => 0), "sent");
  const msg = b.toClient().at(-1).content;
  assert.ok(msg.image, "sent with the photo");
  assert.match(msg.caption, /🏠 \*شقة للبيع\* — #2/);
  t.mock.timers.reset();
});

test("no campaign without matching clients, for a duplicate, or when it would exceed the running limit; one sold meanwhile stops", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const b = bot();
  await b.send(".agent autoblast on");
  await b.send(".listing add فيلا للبيع في زايد بسعر 9 مليون");
  assert.doesNotMatch(b.text(), /📣/, "nobody wants a villa in Zayed");
  await b.send(ADD);
  assert.match(b.text(), /📣 Campaign #1/);
  await b.send(ADD);
  assert.match(b.text(), /⚠️ This looks like #2/);
  assert.doesNotMatch(b.text(), /📣/, "a duplicate isn't sent");

  re.update(b.s, 2, { status: "sold" });
  assert.equal(await campaigns.tick(b.app, T0 + 31 * MIN, () => 0), "done");
  assert.equal(campaigns.get(b.s, 1).status, "stopped");
  assert.equal(b.toClient().length, 0);

  // Five campaigns already running: the new listing isn't queued, and the reply says why.
  for (let i = 0; i < 5; i++) campaigns.start(b.s, re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2e6 + i }, ME), { by: ME, chat: ME });
  await b.send(ADD.replace("3 مليون", "3.3 مليون"));
  assert.match(b.text(), /📣 Not sent automatically: 5 campaigns are already running/);
  t.mock.timers.reset();
});
