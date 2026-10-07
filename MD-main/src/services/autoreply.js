"use strict";

const crypto = require("node:crypto");
const { LRU } = require("../core/lru");
const { zoneNow } = require("./gcschedule");
const { parseQuiet } = require("./autopost");

/**
 * Automatic replies in private chats, for an owner who uses the bot's number for business:
 *   away  (.awaymsg) – "we'll answer soon" outside working hours (or always), once per person per 12 h
 *   greet – a welcome the first time a person ever writes
 * Who was already greeted is kept as salted SHA-256 fingerprints of their WhatsApp id,
 * not as phone numbers. DATA_DIR/autoreply.json:
 *   { away: { text, hours? }, greet: { text }, salt, seen: { [fingerprint]: firstSeen } }
 */

const AWAY_EVERY_MS = 12 * 3600 * 1000;
const MAX_SEEN = 50000;
const MAX_TEXT = 1000;
const awaySent = new LRU({ max: 20000, ttlMs: AWAY_EVERY_MS });

const store = (state) => state.store("autoreply", {});
const settings = (state) => store(state).data;

function setAway(state, changes) {
  return store(state).update((d) => {
    if (changes === null) delete d.away;
    else d.away = { ...(d.away || {}), ...changes };
    return d.away || null;
  });
}
function setGreet(state, text) {
  return store(state).update((d) => {
    if (text === null) delete d.greet;
    else d.greet = { text: String(text).slice(0, MAX_TEXT) };
    return d.greet || null;
  });
}

/** Working hours "10:00-22:00" → is `minutes` (after local midnight) inside them? */
function withinHours(hours, minutes) {
  const r = parseQuiet(hours);
  if (!r) return false;
  return r.start <= r.end ? minutes >= r.start && minutes < r.end : minutes >= r.start || minutes < r.end;
}

const fingerprint = (salt, jid) => crypto.createHash("sha256").update(`${salt}|${jid}`).digest("hex").slice(0, 32);

/** Records the person; true the first time they are seen. */
function firstContact(state, jid, now = Date.now()) {
  return store(state).update((d) => {
    d.salt ||= crypto.randomBytes(16).toString("hex");
    d.seen ||= {};
    const key = fingerprint(d.salt, jid);
    if (d.seen[key]) return false;
    d.seen[key] = now;
    const keys = Object.keys(d.seen);
    if (keys.length > MAX_SEEN) for (const k of keys.sort((a, b) => d.seen[a] - d.seen[b]).slice(0, keys.length - MAX_SEEN)) delete d.seen[k];
    return true;
  });
}

/**
 * What to send to a private message, if anything (welcome and/or away note, as one text).
 * @returns {string|null}
 */
function replyFor(state, jid, timeZone, now = Date.now()) {
  const s = settings(state);
  if (!s.away && !s.greet) return null;
  const parts = [];
  if (s.greet && firstContact(state, jid, now)) parts.push(s.greet.text);
  else if (!s.greet) firstContact(state, jid, now); // remember them, so turning greet on later doesn't greet old contacts
  if (s.away) {
    const outside = !s.away.hours || !withinHours(s.away.hours, zoneNow(timeZone, now).minutes);
    if (outside && !awaySent.get(jid)) {
      awaySent.set(jid, true);
      parts.push(s.away.text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

module.exports = { settings, setAway, setGreet, withinHours, firstContact, replyFor, MAX_TEXT };
