"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const statuspost = require("../src/services/statuspost");
const autolistings = require("../src/services/autolistings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const STATUS = "status@broadcast";

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
  const send = (text) => d.handleMessage(sock, { key: { id: `S${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "", toStatus: () => sock.sent.filter((m) => m.jid === STATUS) };
}

test("the audience: the owner and saved clients with a number, not those who said وقف, at most 1,000", () => {
  const b = bot();
  leads.add(b.s, { name: "أحمد", phone: "201001110001" }, ME);
  leads.add(b.s, { name: "بدون رقم" }, ME);
  const out = leads.add(b.s, { name: "أوقف", phone: "201001110003" }, ME);
  leads.setOptOut(b.s, out.id, true);
  assert.deepEqual(statuspost.audience(b.s, ["201011112222"]), [ME, "201001110001@s.whatsapp.net"]);
  for (let i = 0; i < 1005; i++) leads.add(b.s, { phone: `2011${String(i).padStart(8, "0")}` }, ME);
  assert.equal(statuspost.audience(b.s, []).length, 1000);
});

test(".statuspost 12: the 9:16 design to status@broadcast with the audience as statusJidList", async () => {
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3.2e6 }, ME);
  await b.send(".statuspost 1");
  assert.match(b.text(), /No saved client with a number to show it to yet/);
  assert.equal(b.toStatus().length, 0);

  leads.add(b.s, { name: "أحمد", phone: "201001110001" }, ME);
  await b.send(".statuspost 1");
  const [post] = b.toStatus();
  assert.deepEqual(post.options.statusJidList, [ME, "201001110001@s.whatsapp.net"]);
  assert.equal(post.content.caption, "🏡 شقة للبيع — التجمع\n💰 3,200,000 جنيه\nللاستفسار أرسل: #1");
  const meta = await sharp(post.content.image).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1920]);
  assert.match(b.text(), /📲 #1 is on your status, for 1 saved client\(s\)/);
  assert.equal(re.get(b.s, 1).stats.posted, 1);
  await b.send(".statuspost 99");
  assert.match(b.text(), /Which listing\?/);
});

test(".statuspost daily: one listing a day to the status, going round; off stops it", async () => {
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME);
  re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME);
  leads.add(b.s, { name: "أحمد", phone: "201001110001" }, ME);
  await b.send(".statuspost daily 09:00");
  assert.match(b.text(), /Every day at 09:00 a listing goes to your status, going round your catalogue\.\nNext: #1/);
  await b.send(".statuspost");
  assert.match(b.text(), /Daily: on at 09:00\nAudience: 1 saved client/);

  const day = (d) => Date.parse(`2026-10-${d}T09:05:00+03:00`);
  assert.equal(await autolistings.runDue(b.app, day("08")), 1);
  assert.equal(await autolistings.runDue(b.app, day("08")), 0, "once a day");
  assert.equal(await autolistings.runDue(b.app, day("09")), 1);
  const posts = b.toStatus();
  assert.deepEqual(posts.map((p) => p.content.caption.split("\n")[0]), ["🏡 شقة للبيع — التجمع", "🏡 فيلا للبيع — زايد"]);
  assert.ok(posts.every((p) => p.options.statusJidList.includes("201001110001@s.whatsapp.net")));

  await b.send(".statuspost off");
  assert.equal(autolistings.get(b.s, STATUS), null);
});
