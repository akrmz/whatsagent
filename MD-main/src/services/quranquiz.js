"use strict";

const crypto = require("node:crypto");
const http = require("../core/http");
const { LRU } = require("../core/lru");
const quran = require("./quran");

/**
 * "Which surah is this verse from?" (.quranquiz): a random verse (quran-uthmani from
 * alquran.cloud) and four surahs to choose from — the right one, two near it in the
 * mushaf and one anywhere. The first member to send the right number wins a point;
 * everyone gets one try per round. Scores: DATA_DIR/quranquiz.json.
 */

// Replaceable in tests (offline fixtures).
let getJson = http.getJson;
const setFetcher = (fn) => (getJson = fn || http.getJson);

const ROUND_MS = 45 * 1000;
const MIN_CHARS = 25;
const MAX_CHARS = 220;
const rounds = new LRU({ max: 2000, ttlMs: ROUND_MS + 60 * 1000 });
const scores = (state) => state.store("quranquiz", {});

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];

/**
 * A verse that doesn't give the answer away: not the first of a surah (basmala, opening
 * letters) and of a readable length. @returns {Promise<{ surah, ayah, text }>}
 */
async function randomVerse(tries = 8) {
  for (let i = 0; i < tries; i++) {
    const n = 1 + crypto.randomInt(quran.TOTAL_AYAHS);
    const res = await getJson(`https://api.alquran.cloud/v1/ayah/${n}/quran-uthmani`, { timeoutMs: 15000 });
    const a = res.data;
    const text = String(a?.text || "").trim();
    if (!a?.surah?.number || a.numberInSurah === 1 || text.length < MIN_CHARS || text.length > MAX_CHARS) continue;
    return { surah: a.surah.number, ayah: a.numberInSurah, text };
  }
  throw new Error("no suitable verse found");
}

/** Four surah numbers in random order: the answer, two neighbours, one anywhere. */
function options(correct) {
  const picked = new Set([correct]);
  const near = [];
  for (let d = 1; d <= 6; d++) near.push(correct - d, correct + d);
  const pool = near.filter((n) => n >= 1 && n <= 114);
  while (picked.size < 3 && pool.length) picked.add(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  while (picked.size < 4) picked.add(1 + crypto.randomInt(114));
  const list = [...picked];
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function start(chat, now = Date.now()) {
  if (rounds.get(chat)) return null;
  rounds.set(chat, { pending: true, started: now }); // no second round while fetching
  try {
    const v = await randomVerse();
    const round = { ...v, options: options(v.surah), started: Date.now(), tried: new Set() };
    rounds.set(chat, round);
    return round;
  } catch (err) {
    rounds.delete(chat);
    throw err;
  }
}

const name = (n) => quran.plainName(quran.surahs()[n - 1].name);

function question(round) {
  const lines = round.options.map((n, i) => `${KEYCAPS[i]} ${name(n)}`);
  return `📖 *من أي سورة هذه الآية؟*\n\n﴿${round.text}﴾\n\n${lines.join("\n")}\n\n_أرسل رقم الإجابة خلال ${ar(ROUND_MS / 1000)} ثانية — محاولة واحدة لكل شخص._`;
}

const reveal = (round) => `سورة *${name(round.surah)}* (${round.surah}:${round.ayah})`;

/**
 * A member's answer ("1"–"4", Arabic digits too).
 * @returns {null | { correct: true, round, seconds } | { correct: false }}
 */
function answer(chat, user, text, now = Date.now()) {
  const round = rounds.get(chat);
  const t = String(text || "").trim().replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
  if (!round || round.pending || !/^[1-4]$/.test(t) || now - round.started > ROUND_MS) return null;
  if (round.tried.has(user)) return null; // one try each
  round.tried.add(user);
  if (round.options[Number(t) - 1] !== round.surah) return { correct: false };
  rounds.delete(chat);
  return { correct: true, round, seconds: ((now - round.started) / 1000).toFixed(1) };
}

function expire(chat, round) {
  if (rounds.get(chat) !== round) return false;
  rounds.delete(chat);
  return true;
}

function addPoint(state, chat, user) {
  return scores(state).update((d) => {
    d[chat] ||= {};
    d[chat][user] = (d[chat][user] || 0) + 1;
    return d[chat][user];
  });
}

const leaderboard = (state, chat) =>
  Object.entries(scores(state).data[chat] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

const removeChat = (state, chat) => scores(state).update((d) => delete d[chat]);

module.exports = {
  setFetcher, start, question, answer, reveal, expire, addPoint, leaderboard, removeChat, options, ar,
  active: (chat) => rounds.get(chat) || null,
  ROUND_MS,
};
