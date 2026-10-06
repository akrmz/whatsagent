"use strict";

const crypto = require("node:crypto");
const { LRU } = require("../core/lru");

/** Math quiz rounds per chat: the first correct number within the time limit wins. */

const ROUND_MS = 30 * 1000;
// Kept a little longer than the round; the timer in .mathquiz ends it on time.
const rounds = new LRU({ max: 2000, ttlMs: ROUND_MS + 60 * 1000 });
const scores = (state) => state.store("quiz-scores", {});

const LEVELS = {
  easy: () => {
    const [a, b] = [crypto.randomInt(2, 20), crypto.randomInt(2, 20)];
    return crypto.randomInt(2) ? { q: `${a} + ${b}`, a: a + b } : { q: `${a + b} - ${b}`, a };
  },
  medium: () => {
    const [a, b] = [crypto.randomInt(3, 13), crypto.randomInt(3, 13)];
    const c = crypto.randomInt(5, 50);
    return crypto.randomInt(2) ? { q: `${a} × ${b}`, a: a * b } : { q: `${a} × ${b} + ${c}`, a: a * b + c };
  },
  hard: () => {
    const [a, b] = [crypto.randomInt(11, 40), crypto.randomInt(11, 40)];
    const c = crypto.randomInt(2, 10);
    return crypto.randomInt(2) ? { q: `${a} × ${b}`, a: a * b } : { q: `(${a} + ${b}) × ${c}`, a: (a + b) * c };
  },
};

function start(chat, level = "easy", now = Date.now()) {
  if (rounds.get(chat)) return null;
  const round = { ...LEVELS[level](), level, started: now };
  rounds.set(chat, round);
  return round;
}

/** Checks an answer; returns the won round (and ends it) or null. */
function answer(chat, text, now = Date.now()) {
  const round = rounds.get(chat);
  if (!round || now - round.started > ROUND_MS || !/^-?\d{1,6}$/.test(String(text).trim())) return null;
  if (Number(text) !== round.a) return null;
  rounds.delete(chat);
  return { ...round, seconds: ((now - round.started) / 1000).toFixed(1) };
}

function addPoint(state, chat, user, points) {
  return scores(state).update((d) => {
    d[chat] ||= {};
    d[chat][user] = (d[chat][user] || 0) + points;
    return d[chat][user];
  });
}

const leaderboard = (state, chat) =>
  Object.entries(scores(state).data[chat] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

/** Ends the round if it is still this one (time is up). */
function expire(chat, round) {
  if (rounds.get(chat) !== round) return false;
  rounds.delete(chat);
  return true;
}

module.exports = {
  expire, start, answer, addPoint, leaderboard, LEVELS, ROUND_MS, active: (chat) => rounds.get(chat) || null };
