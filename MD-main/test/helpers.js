"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildConfig } = require("../src/config");
const { createState } = require("../src/core/state");
const { IdentityMap } = require("../src/core/identity");
const { createPermissions } = require("../src/core/permissions");
const { createGroupCache } = require("../src/core/groups");
const { createMessageStore } = require("../src/core/store");
const { LRU } = require("../src/core/lru");
const { sudoList } = require("../src/services/settings");

const OWNER = "201012345678";
const BOT = "15550000009";

function tmpDir(prefix = "bottest-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, child() { return silentLog; } };

/** Builds an app object like src/main.js does, but with fakes and no WhatsApp connection. */
function makeApp({ env = {}, commands, listeners } = {}) {
  const dir = tmpDir();
  const config = buildConfig({
    OWNER_NUMBERS: OWNER,
    DATA_DIR: path.join(dir, "data"),
    SESSION_DIR: path.join(dir, "session"),
    TMP_DIR: path.join(dir, "tmp"),
    LOG_LEVEL: "silent",
    ...env,
  });
  const state = createState({ dataDir: config.paths.data, defaultMode: config.bot.defaultMode, log: silentLog });
  const identity = new IdentityMap();
  const permissions = createPermissions({ owners: config.owners, identity, getSudoList: () => sudoList(state) });
  return {
    config,
    log: silentLog,
    state,
    identity,
    permissions,
    capabilities: {},
    groups: createGroupCache({ identity }),
    store: createMessageStore(),
    sentIds: new LRU({ max: 100 }),
    health: { state: "open", startedAt: Date.now(), lastMessageAt: null },
    commands: commands || { byName: new Map(), list: [], disabled: [] },
    listeners: listeners || { byEvent: new Map(), disabled: [] },
  };
}

/** Fake Baileys socket recording everything sent. */
function makeSock({ participants = [] } = {}) {
  let n = 0;
  const sent = [];
  return {
    user: { id: `${BOT}:3@s.whatsapp.net` },
    sent,
    async sendMessage(jid, content, options) {
      sent.push({ jid, content, options });
      return { key: { id: `SENT${++n}`, remoteJid: jid, fromMe: true } };
    },
    async groupMetadata(jid) {
      return { id: jid, subject: "Test group", participants };
    },
  };
}

let msgCounter = 0;
/** Builds an incoming WhatsApp message. */
function makeMsg({ text, chat = `${OWNER}@s.whatsapp.net`, sender, fromMe = false, key = {} }) {
  const isGroupChat = chat.endsWith("@g.us");
  return {
    key: {
      id: `MSG${++msgCounter}`,
      remoteJid: chat,
      fromMe,
      ...(isGroupChat ? { participant: sender } : {}),
      ...key,
    },
    pushName: "Tester",
    message: { conversation: text },
  };
}

module.exports = { OWNER, BOT, tmpDir, silentLog, makeApp, makeSock, makeMsg };
