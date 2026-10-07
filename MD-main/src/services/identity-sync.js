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

/**
 * Links each phone number to its LID. @returns {Promise<number>} links learned
 * Baileys 7: its LID mapping store (saved with the session, asks WhatsApp only for unknown
 * numbers). Baileys 6.7: onWhatsApp, which returned the LID (7.0's no longer does).
 */
async function linkPhones(sock, identity, pnJids) {
  const list = [...new Set(pnJids.map(normalizeJid).filter(isPn))].slice(0, MAX_LOOKUP);
  if (!list.length) return 0;
  const store = sock.signalRepository?.lidMapping;
  if (typeof store?.getLIDsForPNs === "function") {
    const pairs = (await store.getLIDsForPNs(list)) || [];
    let n = 0;
    for (const p of pairs) {
      if (p?.pn && p?.lid && isLid(normalizeJid(p.lid))) {
        identity.link(p.pn, p.lid);
        n++;
      }
    }
    return n;
  }
  if (typeof sock.onWhatsApp !== "function") return 0;
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

// A flaky network can reconnect many times an hour; reading every group each time could hit
// WhatsApp's rate limits. The links stay in memory between reconnects, so once in a while is enough.
const MIN_INTERVAL_MS = 30 * 60 * 1000;

async function syncIdentities(app, sock, now = Date.now()) {
  const owners = app.config.owners.numbers.map((n) => `${n}@s.whatsapp.net`);
  const sudo = sudoList(app.state);
  const key = [...owners, ...sudo].sort().join(",");
  const last = app.identitySync;
  if (last && now - last.at < MIN_INTERVAL_MS && last.key === key) return { skipped: true };
  const result = { phones: 0, groups: 0 };
  let ok = false;
  try {
    result.phones = await linkPhones(sock, app.identity, [...owners, ...sudo]);
    ok = true;
  } catch (err) {
    app.log.warn({ err: err.message }, "could not look up the owner/sudo LIDs");
  }
  try {
    result.groups = await linkGroupMembers(sock, app.identity);
    ok = true;
  } catch (err) {
    app.log.warn({ err: err.message }, "could not read the group member lists");
  }
  if (ok) app.identitySync = { at: now, key }; // a complete failure is retried on the next connect
  app.log.info(result, "owner/sudo identities refreshed");
  return result;
}

module.exports = { syncIdentities, linkPhones, linkGroupMembers, MIN_INTERVAL_MS };
