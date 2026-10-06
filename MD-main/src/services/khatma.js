"use strict";

const path = require("node:path");
const { UserError } = require("../core/errors");

/**
 * A shared group khatma (ختمة جماعية): members take one of the 30 juz', read it and mark it
 * done; when all 30 are done the khatma is complete. Stored in DATA_DIR/khatma.json as
 *   { [chat]: { round: 2, started, completed: 1, parts: { "5": { by, at, done?, doneAt? } } } }
 * Juz boundaries and page ranges: assets/quran-juz-ar.json (from api.alquran.cloud /meta).
 */

const PARTS = 30;
const MAX_OPEN_PER_MEMBER = 3;
const MAX_CHATS = 300;

let juzData;
const juzInfo = (n) => (juzData ||= require(path.join(__dirname, "..", "..", "assets", "quran-juz-ar.json"))).juz[n - 1];

const store = (state) => state.store("khatma", {});
const get = (state, chat) => store(state).data[chat] || null;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const ar = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
/** Surah names without harakat, easier to read in a short line: النِّسَاءِ → النساء. */
const plain = (s) => s.replace(/[ً-ٰٟۖ-ۭ]/g, "");

function checkPart(n) {
  if (!Number.isInteger(n) || n < 1 || n > PARTS) throw new UserError(`رقم الجزء من 1 إلى ${PARTS}.`);
}

/** Starts a new khatma (the previous one, finished or not, is replaced). */
function start(state, chat, now = Date.now()) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new UserError("Too many groups have a khatma on this bot.");
    const prev = d[chat];
    d[chat] = { round: (prev?.round || 0) + 1, started: now, completed: prev?.completed || 0, parts: {} };
    return d[chat];
  });
}

/** Takes juz n (or the first free one). @returns {number} the juz taken */
function take(state, chat, user, n, now = Date.now()) {
  return store(state).update((d) => {
    const k = d[chat];
    if (!k) throw new UserError("لا توجد ختمة في هذه المجموعة. ابدأ واحدة بـ .khatma new");
    if (n === undefined) {
      n = Array.from({ length: PARTS }, (_, i) => i + 1).find((i) => !k.parts[i]);
      if (!n) throw new UserError("كل الأجزاء محجوزة. ✋");
    }
    checkPart(n);
    const p = k.parts[n];
    if (p?.by === user) throw new UserError(`الجزء ${ar(n)} محجوز لك بالفعل.`);
    if (p) throw new UserError(`الجزء ${ar(n)} ${p.done ? "مقروء" : "محجوز"} بالفعل. اختر جزءاً آخر أو اكتب .khatma take`);
    const open = Object.values(k.parts).filter((x) => x.by === user && !x.done).length;
    if (open >= MAX_OPEN_PER_MEMBER) throw new UserError(`معك ${ar(open)} أجزاء لم تكتمل بعد. أتمّ واحداً أولاً.`);
    k.parts[n] = { by: user, at: now };
    return n;
  });
}

/**
 * Marks juz n (or the member's only open juz) as read. Managers may mark anyone's.
 * @returns {{ n: number, finished: boolean, round: number }}
 */
function done(state, chat, user, n, { manager = false, now = Date.now() } = {}) {
  return store(state).update((d) => {
    const k = d[chat];
    if (!k) throw new UserError("لا توجد ختمة في هذه المجموعة. ابدأ واحدة بـ .khatma new");
    if (n === undefined) {
      const mine = Object.entries(k.parts).filter(([, x]) => x.by === user && !x.done).map(([i]) => Number(i));
      if (!mine.length) throw new UserError("ليس معك جزء محجوز. احجز واحداً بـ .khatma take");
      if (mine.length > 1) throw new UserError(`معك أكثر من جزء (${mine.map(ar).join("، ")}). اكتب رقمه: .khatma done ${mine[0]}`);
      n = mine[0];
    }
    checkPart(n);
    const p = k.parts[n];
    if (p?.done) throw new UserError(`الجزء ${ar(n)} مقروء بالفعل.`);
    if (p && p.by !== user && !manager) throw new UserError(`الجزء ${ar(n)} محجوز لعضو آخر.`);
    k.parts[n] = { by: p?.by || user, at: p?.at || now, done: true, doneAt: now };
    const finished = Object.values(k.parts).filter((x) => x.done).length === PARTS;
    if (finished) {
      k.completed = (k.completed || 0) + 1;
      k.finishedAt = now;
    }
    return { n, finished, round: k.round };
  });
}

/** Gives back a juz that was taken but not read (its owner or a manager). */
function drop(state, chat, user, n, { manager = false } = {}) {
  return store(state).update((d) => {
    const k = d[chat];
    checkPart(n);
    const p = k?.parts[n];
    if (!p || p.done) throw new UserError(`الجزء ${ar(n)} غير محجوز.`);
    if (p.by !== user && !manager) throw new UserError(`الجزء ${ar(n)} محجوز لعضو آخر.`);
    delete k.parts[n];
    return n;
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

function counts(k) {
  const parts = Object.values(k.parts);
  const read = parts.filter((x) => x.done).length;
  return { read, taken: parts.length - read, free: PARTS - parts.length };
}

/** "الجزء ٥ — النساء ٢٤ (ص ٨٢–١٠١)" */
function partLine(n) {
  const j = juzInfo(n);
  return `الجزء ${ar(n)} — ${plain(j.surahName)} ${ar(j.ayah)} (ص ${ar(j.pages[0])}–${ar(j.pages[1])})`;
}

/**
 * The board: progress bar, then every taken juz with its reader, then the free numbers.
 * @returns {{ text: string, mentions: string[] }}
 */
function board(k, at) {
  const { read, taken, free } = counts(k);
  const filled = Math.round((read / PARTS) * 10);
  const bar = "🟩".repeat(filled) + "⬜".repeat(10 - filled);
  const lines = [];
  const mentions = new Set();
  for (let n = 1; n <= PARTS; n++) {
    const p = k.parts[n];
    if (!p) continue;
    mentions.add(p.by);
    lines.push(`${p.done ? "✅" : "📖"} ${ar(n)} — ${at(p.by)}`);
  }
  const freeList = Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => !k.parts[n]);
  const text = [
    `📖 *الختمة الجماعية${k.round > 1 ? ` رقم ${ar(k.round)}` : ""}*`,
    `${bar} ${ar(read)}/${ar(PARTS)}`,
    `✅ مقروء ${ar(read)} · 📖 قيد القراءة ${ar(taken)} · ⬜ متاح ${ar(free)}`,
    lines.length ? `\n${lines.join("\n")}` : "",
    freeList.length ? `\n⬜ الأجزاء المتاحة: ${freeList.map(ar).join("، ")}` : "\n🎉 *تمّت الختمة*",
  ]
    .filter(Boolean)
    .join("\n");
  return { text, mentions: [...mentions] };
}

module.exports = { get, start, take, done, drop, remove, counts, board, partLine, juzInfo, ar, plain, PARTS, MAX_OPEN_PER_MEMBER };
