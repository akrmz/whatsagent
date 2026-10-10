"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const autolistings = require("../src/services/autolistings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const SUDO = "201033334444@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const BROKERS = "120363000000000001@g.us"; // the biggest: number 1
const FAMILY = "120363000000000002@g.us";
const ELSEWHERE = "120363000000000099@g.us"; // the bot isn't in it

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", SUDO_NUMBERS: "201033334444", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  const groups = {
    [BROKERS]: { id: BROKERS, subject: "وسطاء التجمع", participants: [{ id: ME }, { id: CLIENT }, { id: "201055556666@s.whatsapp.net" }] },
    [FAMILY]: { id: FAMILY, subject: "العيلة", participants: [{ id: ME }, { id: CLIENT }] },
  };
  sock.groupFetchAllParticipating = async () => groups;
  sock.groupMetadata = async (jid) => {
    if (!groups[jid]) throw new Error("item-not-found");
    return groups[jid];
  };
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `I${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s: app.state, sock, send, to, text: () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "" };
}

test(".groups shows each group's number and ID, for .in", async () => {
  const b = bot();
  await b.send(".groups");
  assert.match(b.text(), /1\. \*وسطاء التجمع\* · 3 members\n {4}🆔 120363000000000001@g\.us\n2\. \*العيلة\* · 2 members\n {4}🆔 120363000000000002@g\.us/);
  assert.match(b.text(), /\.in <number or ID> <command>, e\.g\. \.in 1 autoazkar on/);
});

test(".in <group> <command>: set up a group from the private chat; the answer comes back here, labelled", async () => {
  const b = bot();
  await b.send(".in 1 autolistings on 10:00 شقة");
  assert.match(b.text(), /^📍 \*وسطاء التجمع\*\n/);
  assert.equal(b.sock.sent.at(-1).jid, ME);
  assert.equal(b.to(BROKERS).length, 0, "nothing written in the group");
  assert.equal(autolistings.get(b.s, BROKERS).time, "10:00", "set up for the group, not for the private chat");
  assert.equal(autolistings.get(b.s, ME), null);

  // By ID, without the @g.us too; group-only commands work.
  await b.send(".in 120363000000000002 jid");
  assert.equal(b.text(), "📍 *العيلة*\n✅ Group JID: 120363000000000002@g.us");
  assert.equal(b.sock.sent.at(-1).options?.quoted, undefined, "the made-up group message is never quoted");

  // Several at once: a summary.
  await b.send(".in 1,2 autolistings on 19:00");
  assert.match(b.text(), /^▶️ \.autolistings in 2 group\(s\):\n✅ وسطاء التجمع\n✅ العيلة$/);
  assert.equal(autolistings.get(b.s, FAMILY).time, "19:00");
  assert.equal(b.to(BROKERS).length + b.to(FAMILY).length, 0);

  // The Islamic daily posts too: the confirmation comes here, a first post goes to the group.
  for (const [cmd, first] of [["autoazkar on", false], ["autohadith every 6", true], ["autowird on 2 06:00", false], ["autotafsir on", true]]) {
    const n = b.sock.sent.length;
    await b.send(`.in 2 ${cmd}`);
    const out = b.sock.sent.slice(n);
    const mine = out.filter((m) => m.jid === ME);
    assert.equal(mine.length, 1, `${cmd}: one confirmation here`);
    assert.match(mine[0].content.text, /^📍 \*العيلة\*\n✅/, `${cmd}: ${mine[0].content.text}`);
    assert.equal(out.filter((m) => m.jid === FAMILY).length, first ? 1 : 0, `${cmd}: the first post in the group`);
    assert.ok(out.every((m) => m.jid === ME || m.jid === FAMILY));
  }

  // Clients' data is still kept out of a mixed group, even when the answer would come here.
  await b.send(".in 1 leads");
  assert.match(b.text(), /^📍 \*وسطاء التجمع\*\n🔒/);
});

test(".in <group> post <command>: the answer is posted in the group, not quoting anything", async () => {
  const b = bot();
  re.add(b.s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME);
  await b.send(".in 1 post listing 1");
  const [posted] = b.to(BROKERS);
  assert.match(posted.content.text, /^🏠 \*شقة للبيع\* — #1/);
  assert.equal(posted.options?.quoted, undefined);
  assert.equal(b.to(ME).length, 0, "nothing extra in the private chat");
});

test(".in: only the owner, only from a private chat, a real group the bot is in, a real command", async () => {
  const b = bot();
  await b.send(".in 9 autoazkar on");
  assert.match(b.text(), /^❌ "9" isn't a group number from \.groups or a group ID/);
  await b.send(`.in ${ELSEWHERE} autoazkar on`);
  assert.match(b.text(), /^❌ The bot isn't in that group, or it doesn't exist\./);
  await b.send(".in 1 nosuchcommand");
  assert.match(b.text(), /^❌ There is no command "nosuchcommand"/);
  await b.send(".in 1 in 2 jid");
  assert.match(b.text(), /^❌ \.in can't run \.in\./);
  await b.send(".in 1");
  assert.match(b.text(), /^Usage: \.in <group number or ID> <command>/);

  const before = b.sock.sent.length;
  await b.send(".in 1 jid", { from: SUDO });
  assert.equal(b.sock.sent.length, before + 1);
  assert.doesNotMatch(b.text(), /Group JID/, "a sudo user can't");
  await b.send(".in 1 jid", { from: CLIENT });
  assert.doesNotMatch(b.text(), /Group JID/, "nor a client");
  await b.send(".in 2 jid", { from: ME, chat: BROKERS });
  assert.match(b.text(), /only works in a private chat/);
});
