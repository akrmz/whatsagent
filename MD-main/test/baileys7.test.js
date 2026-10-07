"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { IdentityMap } = require("../src/core/identity");
const { syncIdentities } = require("../src/services/identity-sync");
const { groupData } = require("../src/services/settings");
const azkar = require("../src/services/azkar");
const { makeApp, makeSock, ALL_OFF, OWNER } = require("./helpers");

// Shapes as Baileys 7.0.0-rc14 produces them (Utils/decode-wa-message.js, Socket/groups.js, messages-recv.js).
const SUDO_PN = "201011112222@s.whatsapp.net";
const SUDO_LID = "98765432109876@lid";
const OWNER_LID = "55566677788899@lid";
const GROUP = "120363000000000013@g.us";

test("the installed Baileys is 7.x and has everything both services import", () => {
  const b = require("@whiskeysockets/baileys");
  assert.match(require("@whiskeysockets/baileys/package.json").version, /^7\./);
  for (const f of ["makeWASocket", "useMultiFileAuthState", "makeCacheableSignalKeyStore", "fetchLatestBaileysVersion", "downloadContentFromMessage"]) assert.equal(typeof b[f], "function", f);
  assert.equal(b.DisconnectReason.loggedOut, 401);
  assert.equal(b.DisconnectReason.restartRequired, 515);
  assert.deepEqual(b.Browsers.ubuntu("Chrome").slice(0, 2), ["Ubuntu", "Chrome"]);
  assert.equal(typeof require("../src/core/media").downloadMedia, "function");
});

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({ commands: loaded, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, key) => d.handleMessage(sock, { key: { id: `S${++n}`, fromMe: false, ...key }, pushName: "x", message: { conversation: text } });
  const replies = async (text, key) => {
    const before = sock.sent.length;
    await send(text, key);
    return sock.sent.slice(before).map((s) => s.content.text || "");
  };
  return { app, sock, d, send, replies };
}

test("a session saved by Baileys 6.7 (no additionalData) loads in 7.0, and 7.0's new key types are stored next to it", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { useMultiFileAuthState, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
  const dir = path.join(require("./helpers").tmpDir(), "session");
  fs.mkdirSync(dir, { recursive: true });
  const creds = initAuthCreds();
  delete creds.additionalData; // as 6.7.24 wrote it
  creds.registered = true;
  creds.me = { id: "201011112222:3@s.whatsapp.net", name: "Bot" };
  fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify(creds, BufferJSON.replacer));
  fs.writeFileSync(path.join(dir, "pre-key-1.json"), JSON.stringify(creds.signedPreKey.keyPair, BufferJSON.replacer));

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  assert.equal(state.creds.registered, true);
  assert.equal(state.creds.me.id, "201011112222:3@s.whatsapp.net");
  assert.ok(Buffer.isBuffer(state.creds.noiseKey.private), "keys come back as bytes");
  const pre = await state.keys.get("pre-key", ["1"]);
  assert.ok(pre["1"]?.public, "the old pre-key is readable");
  await state.keys.set({ "lid-mapping": { "201033334444": "99999999999999" } });
  assert.deepEqual(await state.keys.get("lid-mapping", ["201033334444"]), { 201033334444: "99999999999999" });
  await saveCreds();
  assert.ok(fs.existsSync(path.join(dir, "creds.json")));
});

test("7.0 message keys: a sudo user writing from a LID is recognized through participantAlt / remoteJidAlt", async () => {
  const b = bot();
  await b.send(".mode private", { remoteJid: `${OWNER}@s.whatsapp.net` });
  groupData(b.app.state).update((d) => (d.sudo = [SUDO_PN]));
  // Group: participant is the LID, participantAlt the phone number (addressingMode "lid").
  assert.match((await b.replies(".ping", { remoteJid: GROUP, participant: SUDO_LID, participantAlt: SUDO_PN, addressingMode: "lid" })).join(), /Pong/);
  // Private chat: remoteJid is the LID, remoteJidAlt the phone number.
  const b2 = bot();
  await b2.send(".mode private", { remoteJid: `${OWNER}@s.whatsapp.net` });
  assert.match((await b2.replies(".ping", { remoteJid: OWNER_LID, remoteJidAlt: `${OWNER}@s.whatsapp.net` })).join(), /Pong/);
  assert.deepEqual(await b2.replies(".ping", { remoteJid: "77777777777777@lid" }), [], "a stranger's LID is still a stranger");
});

test("7.0 group events: members as { id, phoneNumber } objects (bot removed → its automations stop)", async () => {
  const b = bot();
  azkar.setAuto(b.app.state, GROUP, {});
  const botLid = "11122233344455@lid";
  b.sock.user.lid = botLid;
  await b.d.handleEvent("group-participants.update", b.sock, {
    id: GROUP,
    author: SUDO_LID,
    authorPn: SUDO_PN,
    participants: [{ id: "99999999999999@lid", phoneNumber: "201033334444@s.whatsapp.net", admin: null }],
    action: "remove",
  });
  assert.ok(azkar.getAuto(b.app.state, GROUP), "someone else leaving changes nothing");
  await b.d.handleEvent("group-participants.update", b.sock, { id: GROUP, participants: [{ id: botLid, admin: null }], action: "remove" });
  assert.equal(azkar.getAuto(b.app.state, GROUP), null, "the bot (by its LID object) left: stopped");
});

test("7.0 member lists and event members teach PN↔LID links", () => {
  const ids = new IdentityMap();
  ids.learnFromParticipants([
    { id: SUDO_LID, phoneNumber: SUDO_PN, admin: "admin" }, // groupMetadata on a LID group
    { id: "201055556666@s.whatsapp.net", lid: "44455566677788@lid", admin: null }, // a PN group with lid
    { id: "33344455566677@lid", admin: null }, // no phone number shared
  ]);
  assert.equal(ids.toPn(SUDO_LID), SUDO_PN);
  assert.equal(ids.toLid("201055556666@s.whatsapp.net"), "44455566677788@lid");
  assert.equal(ids.toPn("33344455566677@lid"), "");
  const fromKey = new IdentityMap();
  fromKey.learnFromKey({ remoteJid: GROUP, participant: SUDO_LID, participantAlt: SUDO_PN });
  assert.equal(fromKey.toPn(SUDO_LID), SUDO_PN);
});

test("7.0 owner/sudo lookup uses the LID mapping store; 7.0's onWhatsApp (no LID) is handled", async () => {
  const b = bot();
  groupData(b.app.state).update((d) => (d.sudo = [SUDO_PN]));
  const asked = [];
  b.sock.signalRepository = {
    lidMapping: {
      getLIDsForPNs: async (pns) => {
        asked.push(...pns);
        return [{ pn: SUDO_PN, lid: SUDO_LID }, { pn: `${OWNER}@s.whatsapp.net`, lid: OWNER_LID }];
      },
    },
  };
  b.sock.groupFetchAllParticipating = async () => ({});
  const r = await syncIdentities(b.app, b.sock);
  assert.equal(r.phones, 2);
  assert.ok(asked.includes(SUDO_PN) && asked.includes(`${OWNER}@s.whatsapp.net`));
  assert.equal(b.app.identity.toLid(SUDO_PN), SUDO_LID);

  const old = bot(); // no mapping store; onWhatsApp as in 7.0: { jid, exists } only
  old.sock.onWhatsApp = async (...jids) => jids.map((jid) => ({ jid, exists: true }));
  old.sock.groupFetchAllParticipating = async () => ({});
  assert.equal((await syncIdentities(old.app, old.sock)).phones, 0, "nothing learned, nothing broken");
});
