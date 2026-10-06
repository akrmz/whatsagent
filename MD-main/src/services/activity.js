"use strict";

/**
 * When each member last wrote in a group, for .inactive. Stored in DATA_DIR/activity.json
 * as { [group]: { since, users: { [jid]: lastSeen } } }, updated at most every 10 minutes
 * per member to keep disk writes low. Only times are kept, never message content.
 */

const RESOLUTION_MS = 10 * 60 * 1000;

const store = (state) => state.store("activity", {});

function seen(state, chat, user, now = Date.now()) {
  const g = store(state).data[chat];
  if (g?.users?.[user] && now - g.users[user] < RESOLUTION_MS) return;
  store(state).update((d) => {
    d[chat] ||= { since: now, users: {} };
    d[chat].users[user] = now;
  });
}

function lastSeen(state, chat, user) {
  return store(state).data[chat]?.users?.[user] || null;
}

const since = (state, chat) => store(state).data[chat]?.since || null;

/**
 * Members not seen for `days` (never seen counts as inactive).
 * @param {Array<{id: string, admin?: string}>} participants
 * @returns {Array<{ jid: string, last: number|null, admin: boolean }>} oldest first
 */
function inactive(state, chat, participants, days, aliasesOf = (j) => [j], now = Date.now()) {
  const users = store(state).data[chat]?.users || {};
  const cutoff = now - days * 86400000;
  return participants
    .map((p) => {
      const last = Math.max(0, ...aliasesOf(p.id).map((a) => users[a] || 0)) || null;
      return { jid: p.id, last, admin: Boolean(p.admin) };
    })
    .filter((m) => !m.last || m.last < cutoff)
    .sort((a, b) => (a.last || 0) - (b.last || 0));
}

module.exports = { seen, lastSeen, since, inactive };
