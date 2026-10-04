"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { IdentityMap, normalizeJid, parseJid } = require("../src/core/identity");
const { createPermissions } = require("../src/core/permissions");

const OWNER = "201012345678";
const OWNER_PN = `${OWNER}@s.whatsapp.net`;
const OWNER_LID = "123456789012345@lid";

function setup({ sudo = [], lids = [] } = {}) {
  const identity = new IdentityMap();
  const perms = createPermissions({ owners: { numbers: [OWNER], lids }, identity, getSudoList: () => sudo });
  return { identity, perms };
}

test("normalizeJid strips device suffixes and maps c.us", () => {
  assert.equal(normalizeJid("201012345678:12@s.whatsapp.net"), OWNER_PN);
  assert.equal(normalizeJid("201012345678@c.us"), OWNER_PN);
  assert.equal(normalizeJid("123:4@lid"), "123@lid");
  assert.equal(normalizeJid("garbage"), "");
  assert.equal(parseJid(undefined), null);
});

test("owner: exact phone match only — no substring bypass", () => {
  const { perms } = setup();
  assert.equal(perms.isOwner(OWNER_PN), true);
  assert.equal(perms.isOwner(`${OWNER}:7@s.whatsapp.net`), true, "device suffix ignored");
  // The old code accepted any JID that merely contained the owner digits:
  assert.equal(perms.isOwner(`9${OWNER}@s.whatsapp.net`), false);
  assert.equal(perms.isOwner(`${OWNER}1@s.whatsapp.net`), false);
  assert.equal(perms.isOwner(`55${OWNER}99@lid`), false);
  assert.equal(perms.isOwner("10123456@s.whatsapp.net"), false);
  assert.equal(perms.isOwner(""), false);
  assert.equal(perms.isOwner(undefined), false);
});

test("owner: an unknown @lid is NOT owner just because the owner is in the group", () => {
  const { identity, perms } = setup();
  // Group lists the owner by phone number; an unrelated member writes from a LID.
  identity.learnFromParticipants([{ id: OWNER_PN }, { id: "999999999999999@lid" }]);
  assert.equal(perms.isOwner("999999999999999@lid"), false);
});

test("owner: LID recognised once the PN↔LID link is learned (Baileys 6.7 key fields)", () => {
  const { identity, perms } = setup();
  assert.equal(perms.isOwner(OWNER_LID), false, "unknown until linked");
  identity.learnFromKey({ remoteJid: "g@g.us", participant: OWNER_LID, participantPn: OWNER_PN });
  assert.equal(perms.isOwner(OWNER_LID), true);
});

test("owner: LID link learned from Baileys 7 alt fields and from participant lists", () => {
  const a = setup();
  a.identity.learnFromKey({ remoteJid: "g@g.us", participant: OWNER_LID, participantAlt: OWNER_PN });
  assert.equal(a.perms.isOwner(OWNER_LID), true);

  const b = setup();
  b.identity.learnFromParticipants([{ id: OWNER_LID, phoneNumber: OWNER_PN, admin: null }]);
  assert.equal(b.perms.isOwner(OWNER_LID), true);

  const c = setup();
  c.identity.learnFromParticipants([{ id: OWNER_LID, jid: OWNER_PN }]); // 6.7.x shape
  assert.equal(c.perms.isOwner(OWNER_LID), true);
});

test("owner: OWNER_LIDS works without any learned mapping", () => {
  const { perms } = setup({ lids: ["123456789012345"] });
  assert.equal(perms.isOwner("123456789012345:9@lid"), true);
});

test("levels: fromMe is owner; sudo list; everyone else user", () => {
  const { perms } = setup({ sudo: ["447911123456@s.whatsapp.net"] });
  assert.equal(perms.levelOf({ sender: "1@s.whatsapp.net", fromMe: true }), "owner");
  assert.equal(perms.levelOf({ sender: OWNER_PN }), "owner");
  assert.equal(perms.levelOf({ sender: "447911123456:2@s.whatsapp.net" }), "sudo");
  assert.equal(perms.levelOf({ sender: "447911123457@s.whatsapp.net" }), "user");
});

test("sudo via LID alias", () => {
  const { identity, perms } = setup({ sudo: ["447911123456@s.whatsapp.net"] });
  identity.link("777@lid", "447911123456@s.whatsapp.net");
  assert.equal(perms.isSudo("777@lid"), true);
});

test("group admin detection across PN/LID/jid/phoneNumber fields", () => {
  const { perms } = setup();
  const participants = [
    { id: "111@lid", phoneNumber: "201000000001@s.whatsapp.net", admin: "admin" },
    { id: "201000000002@s.whatsapp.net", lid: "222@lid", admin: "superadmin" },
    { id: "333@lid", jid: "201000000003@s.whatsapp.net", admin: null },
  ];
  assert.equal(perms.isAdminIn(participants, "111@lid"), true);
  assert.equal(perms.isAdminIn(participants, "201000000001@s.whatsapp.net"), true);
  assert.equal(perms.isAdminIn(participants, "222:5@lid"), true);
  assert.equal(perms.isAdminIn(participants, "333@lid"), false, "member, not admin");
  assert.equal(perms.isAdminIn(participants, "201000000003@s.whatsapp.net"), false);
  assert.equal(perms.isAdminIn(participants, "444@lid"), false);
});

test("allows(): level matrix, group admin only in groups, unknown level fails closed", async () => {
  const { perms } = setup();
  const yes = async () => true;
  const no = async () => false;
  assert.equal(await perms.allows("user", { level: "user", isGroupChat: false, groupAdmin: no }), true);
  assert.equal(await perms.allows("owner", { level: "sudo", isGroupChat: true, groupAdmin: yes }), false);
  assert.equal(await perms.allows("sudo", { level: "owner", isGroupChat: false, groupAdmin: no }), true);
  assert.equal(await perms.allows("groupAdmin", { level: "user", isGroupChat: true, groupAdmin: yes }), true);
  assert.equal(await perms.allows("groupAdmin", { level: "user", isGroupChat: true, groupAdmin: no }), false);
  assert.equal(await perms.allows("groupAdmin", { level: "user", isGroupChat: false, groupAdmin: yes }), false);
  assert.equal(await perms.allows("groupAdmin", { level: "sudo", isGroupChat: true, groupAdmin: no }), true);
  assert.equal(await perms.allows("superuser", { level: "sudo", isGroupChat: true, groupAdmin: yes }), false);
});
