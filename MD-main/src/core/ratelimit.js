"use strict";

const { LRU } = require("./lru");

/**
 * Sliding-window rate limits kept in memory, for things anyone can trigger without a command
 * (commands have their own per-person limit in the dispatcher). Bounded: at most `size` keys.
 * @returns {(key: string) => boolean} true if allowed (and counted), false if over the limit
 */
function createLimiter({ max, windowMs, size = 20000 }) {
  const hits = new LRU({ max: size, ttlMs: windowMs });
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

// One set of limiters per bot (keyed by its state), so several bots in one process (tests) don't share counts.
const perBot = new WeakMap();

/** The limiter called `name` for this bot, created on first use with these options. */
function limiterFor(state, name, opts) {
  let all = perBot.get(state);
  if (!all) perBot.set(state, (all = new Map()));
  if (!all.has(name)) all.set(name, createLimiter(opts));
  return all.get(name);
}

module.exports = { createLimiter, limiterFor };
