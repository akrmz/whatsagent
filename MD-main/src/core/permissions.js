"use strict";

const { normalizeJid, isLid, isPn, userPart, participantIds } = require("./identity");

/**
 * Permission levels, lowest to highest. A command declares the minimum level it needs.
 *   user        anyone
 *   groupAdmin  admin of the current group (sudo and owner always qualify)
 *   sudo        users the owner promoted with .sudo add
 *   owner       numbers in OWNER_NUMBERS / OWNER_LIDS, and the bot account itself
 *
 * Every comparison is exact on the normalized JID. There is no substring matching.
 */
const LEVELS = Object.freeze({ user: 0, groupAdmin: 1, sudo: 2, owner: 3 });

function createPermissions({ owners, identity, getSudoList }) {
  const ownerNumbers = new Set(owners.numbers);
  const ownerLids = new Set(owners.lids);

  function isOwner(jid) {
    for (const alias of identity.aliases(jid)) {
      if (isPn(alias) && ownerNumbers.has(userPart(alias))) return true;
      if (isLid(alias) && ownerLids.has(userPart(alias))) return true;
    }
    return false;
  }

  function isSudo(jid) {
    const sudo = new Set(getSudoList().map(normalizeJid).filter(Boolean));
    if (sudo.size === 0) return false;
    return identity.aliases(jid).some((a) => sudo.has(a));
  }

  /** Base level for a sender, independent of any group. */
  function levelOf({ sender, fromMe }) {
    if (fromMe || isOwner(sender)) return "owner";
    if (isSudo(sender)) return "sudo";
    return "user";
  }

  /** True if `jid` is an admin in the given participant list. */
  function isAdminIn(participants, jid) {
    const wanted = new Set(identity.aliases(jid));
    if (wanted.size === 0) return false;
    return participants.some(
      (p) => (p.admin === "admin" || p.admin === "superadmin") && participantIds(p).some((id) => wanted.has(id)),
    );
  }

  /**
   * Decides whether a sender may run something that needs `required`.
   * `groupAdmin` is a function so group metadata is only fetched when actually needed.
   */
  async function allows(required, { level, isGroupChat, groupAdmin }) {
    const need = LEVELS[required] ?? LEVELS.owner; // unknown levels fail closed
    const have = LEVELS[level] ?? 0;
    if (have >= need) return true;
    if (required === "groupAdmin" && isGroupChat) return Boolean(await groupAdmin());
    return false;
  }

  /**
   * True if every member of a group is the owner, a sudo user, or the bot itself (`self`):
   * a team group, where clients' details may be shown. Unknown members count as outsiders.
   */
  function allStaff(participants, self = []) {
    const me = new Set(self.flatMap((j) => identity.aliases(j)));
    return participants.length > 0 && participants.every((p) => participantIds(p).some((id) => me.has(id) || isOwner(id) || isSudo(id)));
  }

  return { isOwner, isSudo, levelOf, isAdminIn, allows, allStaff };
}

module.exports = { createPermissions, LEVELS };
