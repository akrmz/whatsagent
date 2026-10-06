"use strict";

const { normalizeJid, isPn, isLid } = require("../core/identity");
const { sudoList } = require("./settings");

/**
 * WhatsApp often sends a message with only the sender's LID (no phone number). The bot
 * recognizes the owner and sudo users by both forms, but the PN↔LID links are kept in
 * memory only and were learned just from messages that carried both — so after every
 * restart, a sudo user (or an owner without OWNER_LIDS) could be taken for a stranger
 * until such a message came (in private mode: no reply at all).
 *
 * On every connect this asks WhatsApp directly:
 *   - the LID of each owner and sudo phone number (one usync query: sock.onWhatsApp)
 *   - the members of every group the bot is in (one query; each entry has both forms)
 * Nothing is written to disk.
 */

const MAX_LOOKUP = 100;

/** Links each phone number to its LID. @returns {Promise<number>} links learned */
async function linkPhones(sock, identity, pnJids) {
  const list = [...new Set(pnJids.map(normalizeJid).filter(isPn))].slice(0, MAX_LOOKUP);
  if (!list.length || typeof sock.onWhatsApp !== "function") return 0;
  const results = (await sock.onWhatsApp(...list)) || [];
  let n = 0;
  for (const r of results) {
    const lid = r?.lid && (String(r.lid).includes("@") ? String(r.lid) : `${r.lid}@lid`);
    if (r?.exists && lid && isLid(normalizeJid(lid))) {
      identity.link(r.jid, lid);
      n++;
    }
  }
  return n;
}

/** Learns PN↔LID links from the member lists of all groups. @returns {Promise<number>} groups read */
async function linkGroupMembers(sock, identity) {
  if (typeof sock.groupFetchAllParticipating !== "function") return 0;
  const groups = (await sock.groupFetchAllParticipating()) || {};
  for (const meta of Object.values(groups)) identity.learnFromParticipants(meta?.participants || []);
  return Object.keys(groups).length;
}

async function syncIdentities(app, sock) {
  const owners = app.config.owners.numbers.map((n) => `${n}@s.whatsapp.net`);
  const sudo = sudoList(app.state);
  const result = { phones: 0, groups: 0 };
  try {
    result.phones = await linkPhones(sock, app.identity, [...owners, ...sudo]);
  } catch (err) {
    app.log.warn({ err: err.message }, "could not look up the owner/sudo LIDs");
  }
  try {
    result.groups = await linkGroupMembers(sock, app.identity);
  } catch (err) {
    app.log.warn({ err: err.message }, "could not read the group member lists");
  }
  app.log.info(result, "owner/sudo identities refreshed");
  return result;
}

module.exports = { syncIdentities, linkPhones, linkGroupMembers };
