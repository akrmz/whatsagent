"use strict";

/**
 * Small LRU cache with optional per-entry TTL. Used for anything that would otherwise
 * grow without bound (cooldowns, group metadata, message store, antidelete, LID map).
 * Also implements the get/set/del/flushAll interface Baileys expects from a CacheStore.
 */
class LRU {
  constructor({ max = 1000, ttlMs = 0, onEvict } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.onEvict = onEvict;
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : 0 });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.delete(oldest);
    }
    return this;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    if (this.onEvict) {
      try {
        this.onEvict(key, entry.value);
      } catch {
        /* eviction callbacks must never throw into callers */
      }
    }
    return true;
  }

  clear() {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  values() {
    return [...this.map.values()].map((e) => e.value);
  }

  // Baileys CacheStore interface
  del(key) {
    return this.delete(key);
  }
  flushAll() {
    this.clear();
  }
}

module.exports = { LRU };
