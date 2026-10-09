"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const projects = require("../src/services/projects");
const digest = require("../src/services/digest");
const { groupData } = require("../src/services/settings");
const { makeApp, makeSock, ALL_OFF, BOT } = require("./helpers");

const ME = "201011112222@s.whatsapp.net"; // the owner
const SUDO = "201033334444@s.whatsapp.net";
const OUTSIDER = "201055556666@s.whatsapp.net";
const GROUP = "120363000000000077@g.us";

function bot(members) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const participants = members.map((id) => ({ id }));
  const sock = makeSock({ participants });
  app.sock = sock;
  app.health.state = "open";
  groupData(app.state).update((d) => (d.sudo = [SUDO]));
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = GROUP } = {}) =>
    d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: chat, ...(chat.endsWith("@g.us") ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); // #1
  leads.add(s, { name: "منى", phone: "201099998888", type: "شقة", location: "التجمع", max: 3.5e6, notes: "عايزة دور أرضي" }, ME); // #1
  return { app, sock, send, s, participants, text: () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "" };
}

const CLIENT_DETAILS = /منى|201099998888|دور أرضي/;

test("clients' details only where no outsider reads them: private chat, or a group of staff only", async () => {
  const mixed = bot([ME, SUDO, `${BOT}@s.whatsapp.net`, OUTSIDER]);
  for (const cmd of [".lead 1", ".leads", ".leads منى", ".viewings", ".deals", ".blast 1", ".rentals", ".export leads", ".feed", ".digest on 08:30"]) {
    await mixed.send(cmd);
    assert.match(mixed.text(), /^🔒 \.\w+ shows clients' details \(names, numbers, notes\)\. Use it in your private chat with the bot, or in a group where every member is the owner or a sudo user\.$/, cmd);
  }
  await mixed.send(".lead 1", { from: SUDO });
  assert.match(mixed.text(), /^🔒/, "a sudo user too");
  await mixed.send(".lead 1", { from: OUTSIDER });
  assert.doesNotMatch(mixed.text(), CLIENT_DETAILS);
  assert.doesNotMatch(mixed.sock.sent.map((m) => m.content.text || "").join("\n"), CLIENT_DETAILS, "nothing in the mixed group named the client");

  const team = bot([ME, SUDO, `${BOT}@s.whatsapp.net`]);
  await team.send(".lead 1");
  assert.match(team.text(), /منى[\s\S]*201099998888/, "a team group sees the card");
  await team.send(".leads");
  assert.match(team.text(), /منى/);

  const dm = bot([]);
  await dm.send(".lead 1", { chat: ME });
  assert.match(dm.text(), /201099998888/, "the owner's own chat");
  await dm.send(".lead 1", { from: SUDO, chat: SUDO });
  assert.match(dm.text(), /201099998888/, "a sudo user's own chat");
});

test("in a mixed group, listing and project replies count clients without naming them; match, ask and client offers are refused", async () => {
  const b = bot([ME, `${BOT}@s.whatsapp.net`, OUTSIDER]);
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع\nالسعر: 3.2 مليون\nالمالك: أبو أحمد 01001234567");
  assert.match(b.text(), /🎯 يناسب 1 من عملائك\n\.listing match 2 \(in your private chat with the bot\)/);
  await b.send(".listing edit 1 السعر: 2.5 مليون");
  assert.match(b.text(), /📉 السعر انخفض 17%/);
  await b.send(".listing match 1");
  assert.match(b.text(), /^🔒 The clients for #1 are private/);
  await b.send(".listing ask 2");
  assert.match(b.text(), /^🔒 Owners' answers name them/);
  assert.equal(b.sock.sent.filter((m) => m.jid === "201001234567@s.whatsapp.net").length, 0, "the owner wasn't asked");
  projects.add(b.s, { name: "مشروع", location: "التجمع", types: ["شقة"], from: 3e6 }, ME);
  await b.send(".project 1");
  assert.match(b.text(), /🎯 يناسب 1 من عملائك \(الأسماء في الشات الخاص مع البوت\)/);
  await b.send(".offer 1 #1");
  assert.match(b.text(), /🔒 An offer for a client names them/);
  assert.doesNotMatch(b.sock.sent.map((m) => m.content.text || m.content.caption || "").join("\n"), CLIENT_DETAILS);

  const dm = bot([]);
  await dm.send(".listing match 1", { chat: ME });
  assert.match(dm.text(), /منى/, "in private, the names");
});

test("the morning summary in a group that is no longer staff only is held; unknown members count as outsiders", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-11T05:00:00Z") }); // 08:00 Cairo
  const b = bot([ME, `${BOT}@s.whatsapp.net`]);
  await b.send(".digest on 08:30");
  assert.doesNotMatch(b.text(), /^🔒/, "turned on in a staff group");
  b.participants.push({ id: OUTSIDER }); // someone else joins
  b.app.groups.invalidate(GROUP);
  assert.equal(await digest.runDue(b.app, Date.parse("2026-10-11T05:31:00Z")), 1);
  const sent = b.sock.sent.at(-1);
  assert.equal(sent.jid, GROUP);
  assert.match(sent.content.text, /^🔒 ملخص الصباح متوقف هنا/);
  assert.doesNotMatch(sent.content.text, CLIENT_DETAILS);

  b.sock.groupMetadata = async () => {
    throw new Error("timed out");
  };
  b.app.groups.invalidate(GROUP);
  await b.send(".lead 1");
  assert.match(b.text(), /^🔒/, "members unknown: refused");
  t.mock.timers.reset();
});
