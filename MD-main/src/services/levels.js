"use strict";

const crypto = require("node:crypto");
const { LRU } = require("../core/lru");

/**
 * Chat levels per group: each member earns 15–25 XP for a message, at most once a
 * minute (so spamming doesn't help). Stored in DATA_DIR/levels.json as
 * { [group]: { [user]: xp } }; level-up announcements are opt-in per group.
 */

const COOLDOWN_MS = 60 * 1000;
const recent = new LRU({ max: 50000, ttlMs: COOLDOWN_MS });

const store = (state) => state.store("levels", {});
const announceStore = (state) => state.store("levels-announce", {});

/** XP needed to go from `level` to `level + 1`. */
const needed = (level) => 5 * level * level + 50 * level + 100;

function levelOf(xp) {
  let level = 0;
  let rest = xp;
  while (rest >= needed(level)) {
    rest -= needed(level);
    level++;
  }
  return { level, current: rest, needed: needed(level) };
}

/** Adds XP for a message. @returns {{ gained: number, level: number, levelUp: boolean } | null} */
function addXp(state, chat, user, now = Date.now()) {
  const key = `${chat}|${user}`;
  if (recent.get(key)) return null;
  recent.set(key, now);
  const gained = 15 + crypto.randomInt(11);
  return store(state).update((d) => {
    d[chat] ||= {};
    const before = levelOf(d[chat][user] || 0).level;
    d[chat][user] = (d[chat][user] || 0) + gained;
    const after = levelOf(d[chat][user]).level;
    return { gained, level: after, levelUp: after > before };
  });
}

function stats(state, chat, user) {
  const all = store(state).data[chat] || {};
  const xp = all[user] || 0;
  const rank = 1 + Object.values(all).filter((v) => v > xp).length;
  return { xp, rank, ...levelOf(xp) };
}

const top = (state, chat, n = 10) =>
  Object.entries(store(state).data[chat] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([user, xp]) => ({ user, xp, level: levelOf(xp).level }));

const announces = (state, chat) => Boolean(announceStore(state).data[chat]);
const setAnnounce = (state, chat, on) => announceStore(state).update((d) => (on ? (d[chat] = true) : delete d[chat]));

function reset(state, chat) {
  store(state).update((d) => delete d[chat]);
}

module.exports = { addXp, stats, top, levelOf, needed, announces, setAnnounce, reset };
