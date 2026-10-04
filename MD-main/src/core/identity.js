"use strict";

const { LRU } = require("./lru");

/**
 * WhatsApp identifies people two ways:
 *   PN  (phone number)  201012345678@s.whatsapp.net
 *   LID (anonymous id)  123456789012345@lid
 * and either may carry a device suffix (":12"). Groups increasingly show members by LID,
 * so permission checks must be able to translate between the two. Mappings are learned
 * from message keys and group participant lists (both Baileys 6.7 and 7.x field names).
 */

function parseJid(jid) {
  if (typeof jid !== "string") return null;
  const at = jid.indexOf("@");
  if (at < 1) return null;
  let server = jid.slice(at + 1);
  if (server === "c.us") server = "s.whatsapp.net";
  let user = jid.slice(0, at);
  let device;
  const colon = user.indexOf(":");
  if (colon >= 0) {
    device = user.slice(colon + 1);
    user = user.slice(0, colon);
  }
  if (!user || !server) return null;
  return { user, server, device };
}

/** "2010...:7@s.whatsapp.net" → "2010...@s.whatsapp.net". Returns "" for invalid input. */
function normalizeJid(jid) {
  const p = parseJid(jid);
  return p ? `${p.user}@${p.server}` : "";
}

const isLid = (jid) => parseJid(jid)?.server === "lid";
const isPn = (jid) => parseJid(jid)?.server === "s.whatsapp.net";
const isGroup = (jid) => typeof jid === "string" && jid.endsWith("@g.us");
const userPart = (jid) => parseJid(jid)?.user ?? "";

class IdentityMap {
  constructor({ max = 20000 } = {}) {
    this.lidToPn = new LRU({ max });
    this.pnToLid = new LRU({ max });
  }

  /** Remember that two JIDs (in any order) are the same person. */
  link(a, b) {
    const x = normalizeJid(a);
    const y = normalizeJid(b);
    if (!x || !y || x === y) return;
    const lid = isLid(x) ? x : isLid(y) ? y : null;
    const pn = isPn(x) ? x : isPn(y) ? y : null;
    if (!lid || !pn) return;
    this.lidToPn.set(lid, pn);
    this.pnToLid.set(pn, lid);
  }

  toPn(jid) {
    const n = normalizeJid(jid);
    if (isPn(n)) return n;
    return isLid(n) ? this.lidToPn.get(n) || "" : "";
  }

  toLid(jid) {
    const n = normalizeJid(jid);
    if (isLid(n)) return n;
    return isPn(n) ? this.pnToLid.get(n) || "" : "";
  }

  /** All known forms of a JID (normalized, PN and LID when known). */
  aliases(jid) {
    const n = normalizeJid(jid);
    return [...new Set([n, this.toPn(n), this.toLid(n)].filter(Boolean))];
  }

  learnFromKey(key = {}) {
    // Baileys 6.7.x
    this.link(key.participant, key.participantPn);
    this.link(key.participant, key.participantLid);
    this.link(key.remoteJid, key.senderPn);
    this.link(key.remoteJid, key.senderLid);
    // Baileys 7.x
    this.link(key.participant, key.participantAlt);
    this.link(key.remoteJid, key.remoteJidAlt);
  }

  learnFromParticipants(participants = []) {
    for (const p of participants) {
      this.link(p.id, p.lid);
      this.link(p.id, p.jid); // 6.7.x
      this.link(p.id, p.phoneNumber); // 7.x
      this.link(p.lid, p.jid);
      this.link(p.lid, p.phoneNumber);
    }
  }
}

/** Returns every JID that refers to the given group participant entry. */
function participantIds(p) {
  return [p.id, p.lid, p.jid, p.phoneNumber].map(normalizeJid).filter(Boolean);
}

module.exports = { parseJid, normalizeJid, isLid, isPn, isGroup, userPart, IdentityMap, participantIds };
