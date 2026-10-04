"use strict";

const { LRU } = require("./lru");

/**
 * Cached group metadata (5 minutes). Also passed to Baileys as `cachedGroupMetadata`,
 * which avoids a metadata request for every message sent to a group.
 * Invalidated whenever WhatsApp reports group or participant changes.
 */
function createGroupCache({ identity, ttlMs = 5 * 60 * 1000, max = 1000 } = {}) {
  const cache = new LRU({ max, ttlMs });
  const inflight = new Map();

  async function get(sock, jid) {
    const hit = cache.get(jid);
    if (hit) return hit;
    if (inflight.has(jid)) return inflight.get(jid);
    const p = sock
      .groupMetadata(jid)
      .then((meta) => {
        cache.set(jid, meta);
        identity?.learnFromParticipants(meta.participants || []);
        return meta;
      })
      .finally(() => inflight.delete(jid));
    inflight.set(jid, p);
    return p;
  }

  return {
    get,
    invalidate: (jid) => cache.delete(jid),
    clear: () => cache.clear(),
    /** For makeWASocket({ cachedGroupMetadata }) */
    cachedGroupMetadata: async (jid) => cache.get(jid),
  };
}

module.exports = { createGroupCache };
