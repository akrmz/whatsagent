"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const prayertimes = require("./prayertimes");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * Adhkar and duas from Hisn al-Muslim (حصن المسلم), bundled in assets/hisnmuslim-ar.json
 * (see scripts/fetch-hisnmuslim.js), and the daily auto-send per chat (.autoazkar).
 */

let book = null;
const data = () => (book ||= require(path.join(__dirname, "..", "..", "assets", "hisnmuslim-ar.json")));
const chapter = (id) => data().chapters.find((c) => c.id === id);

// Sets that .azkar sends, by chapter in Hisn al-Muslim.
const SETS = {
  morning: { chapter: 27, title: "🌅 *أذكار الصباح*" },
  evening: { chapter: 27, title: "🌇 *أذكار المساء*" },
  sleep: { chapter: 28, title: "🌙 *أذكار النوم*" },
  waking: { chapter: 1, title: "☀️ *أذكار الاستيقاظ من النوم*" },
  prayer: { chapter: 25, title: "🕌 *الأذكار بعد السلام من الصلاة*" },
};
const SET_WORDS = {
  morning: ["morning", "sabah", "صباح", "الصباح"],
  evening: ["evening", "masaa", "masa", "مساء", "المساء"],
  sleep: ["sleep", "night", "nawm", "نوم", "النوم"],
  waking: ["wake", "waking", "استيقاظ", "الاستيقاظ"],
  prayer: ["prayer", "salah", "salat", "صلاة", "الصلاة"],
};

// Chapters for a random dua at any time (not tied to a place or situation).
// (Chapters 129/130 are hadiths about the virtue of istighfar/tasbih, not supplications.)
const DUA_CHAPTERS = [24, 32, 34, 35, 40, 41, 43, 44, 92];
// The book puts the words to say in (( … )); narrations start differently.
const isSupplication = (x) => x.text.startsWith("((");

const FOOTER = "\n\n📖 _حصن المسلم_";
const FRIDAY_NOTE = "\n\n🕌 *يوم الجمعة*: لا تنسوا قراءة سورة الكهف، والإكثار من الصلاة على النبي ﷺ.";

function setFrom(word) {
  const w = String(word || "").toLowerCase();
  return Object.keys(SET_WORDS).find((k) => SET_WORDS[k].includes(w)) || null;
}

/** "(×3)" after a dhikr said more than once, unless the book's text already says it ("ثلاث مرات"). */
function times(n, text = "") {
  const plain = text.replace(/[ً-ْٰ]/g, ""); // without diacritics
  return n > 1 && !/مر(ات|ة)/.test(plain) ? ` _(×${n})_` : "";
}

/**
 * The book ends some adhkar with a note in brackets such as "(مائة مرة إذا أصبح)" or
 * "(ثلاث مرات إذا أمسى)": those belong to the morning or the evening only.
 */
function onlyWhen(text) {
  const plain = text.replace(/[ً-ْٰ]/g, "");
  const note = (plain.match(/\(([^()]*)\)\.?\s*$/) || [])[1] || "";
  if (/إذا أصبح/.test(note)) return "morning";
  if (/إذا أمسى/.test(note)) return "evening";
  return null;
}

/**
 * The text of one set. Morning and evening share a chapter in the book; the one entry
 * marked for the evening only is left out in the morning, and the reverse.
 */
function setText(kind, { friday = false } = {}) {
  const set = SETS[kind];
  let items = chapter(set.chapter).items;
  if (kind === "morning") items = items.filter((x) => onlyWhen(x.text) !== "evening");
  if (kind === "evening") items = items.filter((x) => onlyWhen(x.text) !== "morning");
  const body = items.map((x, i) => `*${i + 1}.* ${x.text}${times(x.repeat, x.text)}`).join("\n\n");
  return `${set.title}\n\n${body}${friday && kind === "morning" ? FRIDAY_NOTE : ""}${FOOTER}`;
}

/** A random dua, optionally from chapters whose title contains `topic`. */
function randomDua(topic = "") {
  const t = String(topic).trim();
  const pool = (t ? data().chapters.filter((c) => c.title.includes(t)) : DUA_CHAPTERS.map(chapter)).filter(Boolean);
  if (!pool.length) return null;
  const all = pool.flatMap((c) => c.items.map((x) => ({ ...x, title: c.title })));
  const items = all.filter(isSupplication).length ? all.filter(isSupplication) : all;
  return items[crypto.randomInt(items.length)];
}

const duaText = (d) => `🤲 *${d.title}*\n\n${d.text}${times(d.repeat, d.text)}${FOOTER}`;

function chapterText(id) {
  const c = chapter(id);
  if (!c) return null;
  return `📖 *${c.id}. ${c.title}*\n\n${c.items.map((x, i) => `${c.items.length > 1 ? `*${i + 1}.* ` : ""}${x.text}${times(x.repeat, x.text)}`).join("\n\n")}${FOOTER}`;
}

/** The items of one chapter (e.g. 68: the iftar dua). */
const chapterItems = (id) => chapter(id)?.items || [];
const searchChapters = (word) => data().chapters.filter((c) => c.title.includes(word));
const chapters = () => data().chapters.map((c) => ({ id: c.id, title: c.title }));

// ---- Daily auto-send (.autoazkar) ------------------------------------------------------------

const MAX_CHATS = 300;
const LATE_LIMIT_MIN = 180;
const DEFAULTS = { morning: "06:30", evening: "17:00" };
const autoStore = (state) => state.store("azkar-auto", {});

function getAuto(state, chat) {
  return autoStore(state).data[chat] || null;
}

function setAuto(state, chat, changes) {
  return autoStore(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { ...(d[chat] || { ...DEFAULTS, dua: null, city: null, done: {} }), ...changes };
    return d[chat];
  });
}

const removeAuto = (state, chat) => autoStore(state).update((d) => delete d[chat]);

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Where this chat's clock runs and when each message is sent today (minutes after local
 * midnight). With a city: the city's own time zone, morning adhkar 30 min after Fajr and
 * evening adhkar 30 min after Asr (their times in the Sunnah). Otherwise the bot's
 * TIMEZONE and the fixed times. A failed lookup falls back to the fixed times.
 * @returns {Promise<{ zone, day, minutes, at: { morning, evening, dua } }>}
 */
async function schedule(entry, botZone, now = Date.now(), lookup) {
  const at = { morning: parseClock(entry.morning || DEFAULTS.morning), evening: parseClock(entry.evening || DEFAULTS.evening), dua: entry.dua ? parseClock(entry.dua) : null };
  if (entry.city) {
    try {
      const p = await prayertimes.forCity(entry.city, now, lookup);
      return { zone: p.zone, day: p.day, minutes: p.minutes, at: { ...at, morning: p.times.Fajr + 30, evening: p.times.Asr + 30 } };
    } catch {
      /* lookup failed: fixed times in the bot's zone today */
    }
  }
  return { zone: botZone, ...zoneNow(botZone, now), at };
}

/**
 * The next daily message for a chat, for status replies: which one, at what local time,
 * and in how many minutes. @returns {Promise<{ kind, at, inMinutes, zone }>}
 */
async function nextSend(entry, botZone, now = Date.now(), lookup) {
  const { zone, day, minutes, at } = await schedule(entry, botZone, now, lookup);
  const today = ["morning", "evening", "dua"]
    .filter((k) => at[k] !== null && at[k] !== undefined && at[k] > minutes && entry.done?.[k] !== day)
    .sort((a, b) => at[a] - at[b]);
  if (today.length) return { kind: today[0], at: at[today[0]], inMinutes: at[today[0]] - minutes, zone };
  // Tomorrow's first (times barely move from one day to the next).
  const first = ["morning", "evening", "dua"].filter((k) => at[k] !== null && at[k] !== undefined).sort((a, b) => at[a] - at[b])[0];
  return { kind: first, at: at[first], inMinutes: 1440 - minutes + at[first], zone };
}

/** What is due now for one chat. Exported for tests. */
async function dueFor(entry, botZone, now = Date.now(), lookup) {
  const { zone, day, minutes, at } = await schedule(entry, botZone, now, lookup);
  const due = [];
  for (const kind of ["morning", "evening", "dua"]) {
    if (at[kind] === null || at[kind] === undefined || entry.done?.[kind] === day) continue;
    const late = minutes - at[kind];
    if (late >= 0 && late <= LATE_LIMIT_MIN) due.push({ kind, day, zone });
  }
  return due;
}

const isFriday = (timeZone, now) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(now)) === "Fri";

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = autoStore(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    for (const { kind, day, zone: chatZone } of await dueFor(entry, zone, now)) {
      s.update(() => {
        entry.done ||= {};
        entry.done[kind] = day;
      });
      const text = kind === "dua" ? duaText(randomDua()) : setText(kind, { friday: isFriday(chatZone, now) });
      try {
        await app.sock.sendMessage(chat, { text });
        sent++;
      } catch (err) {
        app.log.warn({ err: err.message, kind }, "could not send daily adhkar");
      }
    }
  }
  return sent;
}

function startAzkarLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "adhkar loop failed");
    } finally {
      running = false;
    }
  }, 30 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Marks today's past times as done, so turning it on at noon doesn't send the morning set. */
async function skipPassed(state, chat, timeZone, now = Date.now()) {
  const entry = getAuto(state, chat);
  if (!entry) return;
  const { day, minutes, at } = await schedule(entry, timeZone, now);
  autoStore(state).update(() => {
    entry.done ||= {};
    for (const kind of ["morning", "evening", "dua"]) {
      if (at[kind] !== null && at[kind] !== undefined && minutes >= at[kind]) entry.done[kind] = day;
      else delete entry.done[kind];
    }
  });
}

module.exports = {
  SETS,
  setFrom,
  setText,
  randomDua,
  duaText,
  chapterText,
  searchChapters,
  chapterItems,
  chapters,
  getAuto,
  setAuto,
  removeAuto,
  schedule,
  nextSend,
  dueFor,
  runDue,
  startAzkarLoop,
  skipPassed,
  hhmm,
  DEFAULTS,
  MAX_CHATS,
};
