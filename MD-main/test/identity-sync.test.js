"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { syncIdentities } = require("../src/services/identity-sync");
const { sudoList } = require("../src/services/settings");
const { makeApp, makeSock, ALL_OFF, OWNER } = require("./helpers");

const SUDO_PN = "201011112222@s.whatsapp.net";
const SUDO_LID = "98765432109876@lid";
const OTHER_PN = "201033334444@s.whatsapp.net";
const OTHER_LID = "11122233344455@lid";
const OWNER_LID = "55566677788899@lid";
const GROUP = "120363000000000099@g.us";

/** The real dispatcher; the fake socket answers onWhatsApp and group lists like Baileys 6.7.24. */
function bot() {
  const app = makeApp({ commands: loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF }), listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [] });
  const lids = { [SUDO_PN]: SUDO_LID, [`${OWNER}@s.whatsapp.net`]: OWNER_LID };
  sock.lookups = [];
  sock.onWhatsApp = async (...jids) => {
    sock.lookups.push(...jids);
    return jids.filter((j) => lids[j]).map((j) => ({ jid: j, exists: true, lid: lids[j] }));
  };
  sock.groupFetchAllParticipating = async () => ({
    [GROUP]: { id: GROUP, participants: [{ id: OTHER_LID, jid: OTHER_PN, lid: OTHER_LID, admin: null }] },
  });
  app.sock = sock;
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, key, mentions) =>
    d.handleMessage(sock, {
      key: { id: `M${++n}`, fromMe: false, ...key },
      pushName: "x",
      message: mentions ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } } : { conversation: text },
    });
  const owner = (text) => send(text, { remoteJid: `${OWNER}@s.whatsapp.net` });
  const replies = async (text, key) => {
    const before = sock.sent.length;
    await send(text, key);
    return sock.sent.slice(before).map((s) => s.content.text || "");
  };
  const mention = (text, jids) => send(text, { remoteJid: GROUP, participant: `${OWNER}@s.whatsapp.net` }, jids);
  return { app, sock, owner, replies, mention };
}

test("a sudo user writing with only their LID (no phone number attached) is recognized", async () => {
  const b = bot();
  await b.owner(".mode private");
  // Stored by phone number only, as before 2.18.2; the bot then restarted (no links in memory).
  require("../src/services/settings").groupData(b.app.state).update((d) => (d.sudo = [SUDO_PN]));
  assert.deepEqual(await b.replies(".ping", { remoteJid: SUDO_LID }), [], "reproduces the bug: ignored in private mode");

  await syncIdentities(b.app, b.sock);
  assert.ok(b.sock.lookups.includes(SUDO_PN) && b.sock.lookups.includes(`${OWNER}@s.whatsapp.net`), "owners and sudo looked up in one go");
  assert.match((await b.replies(".ping", { remoteJid: SUDO_LID })).join(), /Pong/, "private chat, LID only");
  assert.match((await b.replies(".ping", { remoteJid: GROUP, participant: SUDO_LID })).join(), /Pong/, "group, LID only");
  assert.match((await b.replies(".ping", { remoteJid: OWNER_LID })).join(), /Pong/, "the owner too, without OWNER_LIDS");
  assert.deepEqual(await b.replies(".ping", { remoteJid: "77777777777777@lid" }), [], "strangers are still ignored in private mode");
});

test(".sudo add stores the phone number and the LID; .sudo list shows one line per person; .sudo del removes both", async () => {
  const b = bot();
  await b.owner(".sudo add 201011112222");
  assert.deepEqual(sudoList(b.app.state).sort(), [SUDO_LID, SUDO_PN].sort());
  await syncIdentities(b.app, b.sock); // learns OTHER from the group list
  await b.mention(`.sudo add @${OTHER_LID.split("@")[0]}`, [OTHER_LID]); // a mention in a LID group gives the LID
  assert.ok(sudoList(b.app.state).includes(OTHER_LID) && sudoList(b.app.state).includes(OTHER_PN), "LID mention: phone number added from the group list");
  const list = (await b.replies(".sudo list", { remoteJid: `${OWNER}@s.whatsapp.net` })).join();
  assert.match(list, /1\. \+201011112222 ✓\n2\. \+201033334444 ✓/);
  await b.owner(".sudo del 201011112222");
  assert.deepEqual(sudoList(b.app.state).sort(), [OTHER_LID, OTHER_PN].sort(), "both forms removed");
});

test("identity sync survives a socket without the lookups or with failing ones", async () => {
  const b = bot();
  delete b.sock.onWhatsApp;
  b.sock.groupFetchAllParticipating = async () => Promise.reject(new Error("rate-overlimit"));
  assert.deepEqual(await syncIdentities(b.app, b.sock), { phones: 0, groups: 0 });
});
