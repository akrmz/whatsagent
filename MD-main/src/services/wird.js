"use strict";

const http = require("../core/http");

// Replaceable in tests (offline fixtures).
let getJson = http.getJson;
const setFetcher = (fn) => (getJson = fn || http.getJson);
const { LRU } = require("../core/lru");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * Daily Quran reading (الورد اليومي) for a chat: N pages a day, in order from page 1 to
 * 604, then a new khatma starts. Page text from alquran.cloud (Madani mushaf pages).
 * Stored in DATA_DIR/wird.json as { [chat]: { pages, time, next, khatmas, done } }.
 */

const TOTAL_PAGES = 604;
const MAX_PAGES = 20;
const MAX_CHATS = 300;
const LATE_LIMIT_MIN = 180;
const DEFAULT_TIME = "20:00";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const cache = new LRU({ max: 100, ttlMs: 7 * 24 * 60 * 60 * 1000 });

const BASMALA = "بسم الله الرحمن الرحيم";
/** Arabic letters only (no diacritics, alef variants unified), for comparing spellings. */
const letters = (s) =>
  String(s)
    .replace(/[ً-ٰٟۖ-ۭ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/\s+/g, "");
const toArabicDigits =(n) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[d]);
const store = (state) => state.store("wird", {});

/** One mushaf page as text, with surah headers and verse numbers ﴿١﴾. */
async function pageText(page) {
  const hit = cache.get(page);
  if (hit) return hit;
  const res = await getJson(`https://api.alquran.cloud/v1/page/${page}/quran-uthmani`, { timeoutMs: 20000 });
  const ayahs = res.data?.ayahs || [];
  if (!ayahs.length) throw new Error(`no text for page ${page}`);
  const parts = [];
  let surah = null;
  for (const a of ayahs) {
    // alquran.cloud puts a byte-order mark before the first verse of the Quran.
    let text = a.text.split(String.fromCharCode(0xfeff)).join("").trim();
    if (a.surah.number !== surah) {
      surah = a.surah.number;
      parts.push(`\n🕋 *${a.surah.name}*\n`);
      // Verse 1 of each surah (except al-Fatiha, where it is verse 1 itself) starts with the
      // basmala in this source; in the mushaf it is a separate line under the surah name.
      const words = text.split(/\s+/);
      if (a.numberInSurah === 1 && surah !== 1 && words.length > 4 && letters(words.slice(0, 4).join(" ")) === letters(BASMALA)) {
        parts.push(`${words.slice(0, 4).join(" ")}\n`); // the source's own spelling
        text = words.slice(4).join(" ");
      }
    }
    parts.push(`${text} ﴿${toArabicDigits(a.numberInSurah)}﴾`);
  }
  const first = ayahs[0];
  const out = { text: parts.join(" ").replace(/ ?\n ?/g, "\n").trim(), juz: first.juz, surah: first.surah.name };
  cache.set(page, out);
  return out;
}

/** The text for pages from..to (wrapping after 604). */
async function portion(from, count) {
  const pages = Array.from({ length: count }, (_, i) => ((from - 1 + i) % TOTAL_PAGES) + 1);
  const texts = [];
  for (const p of pages) texts.push({ page: p, ...(await pageText(p)) });
  return texts;
}

/** Arabic "N pages": صفحة واحدة، صفحتان، 3 صفحات، 11 صفحة. */
const pagesAr = (n) => (n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتان" : n <= 10 ? `${n} صفحات` : `${n} صفحة`);

/** view: just showing pages (no progress or khatma message). */
function formatPortion(texts, { khatmas = 0, view = false } = {}) {
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (view) {
    const t = texts.map((x) => `— صفحة ${x.page} —\n${x.text}`).join("\n\n");
    return `📖 *من المصحف* — صفحة ${first.page} من ${TOTAL_PAGES} · الجزء ${first.juz}\n\n${t}`;
  }
  const head = `📖 *الورد اليومي* — صفحة ${first.page}${texts.length > 1 ? `–${last.page}` : ""} من ${TOTAL_PAGES} · الجزء ${first.juz}`;
  const body = texts.map((t) => `— صفحة ${t.page} —\n${t.text}`).join("\n\n");
  const finished = texts.some((t) => t.page === TOTAL_PAGES); // also when the portion wraps to page 1
  const progress = finished ? 100 : Math.round((last.page / TOTAL_PAGES) * 100);
  const done = finished ? "\n\n🎉 *تم بحمد الله ختم القرآن الكريم!* وتبدأ ختمة جديدة." : "";
  return `${head}\n\n${body}\n\n📊 التقدم: ${progress}%${khatmas ? ` · الختمات: ${khatmas}` : ""}${done}`;
}

const get = (state, chat) => store(state).data[chat] || null;

function set(state, chat, { pages, time }) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { next: 1, khatmas: 0, done: null, ...(d[chat] || {}), pages, time };
    return d[chat];
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

function setPosition(state, chat, page) {
  return store(state).update((d) => {
    if (d[chat]) d[chat].next = page;
  });
}

/** Builds today's portion and moves the position forward. */
async function takePortion(state, chat) {
  const entry = get(state, chat);
  const texts = await portion(entry.next, entry.pages);
  const last = texts[texts.length - 1].page;
  store(state).update(() => {
    if (texts.some((t) => t.page === TOTAL_PAGES)) entry.khatmas = (entry.khatmas || 0) + 1;
    entry.next = (last % TOTAL_PAGES) + 1;
  });
  return formatPortion(texts, { khatmas: entry.khatmas });
}

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const { day, minutes } = zoneNow(app.config.bot.timezone, now);
  let sent = 0;
  for (const [chat, entry] of Object.entries(store(app.state).data)) {
    const at = parseClock(entry.time || DEFAULT_TIME);
    const late = minutes - at;
    if (entry.done === day || late < 0 || late > LATE_LIMIT_MIN) continue;
    store(app.state).update(() => (entry.done = day));
    try {
      await app.sock.sendMessage(chat, { text: await takePortion(app.state, chat) });
      sent++;
    } catch (err) {
      store(app.state).update(() => (entry.done = null)); // try again next minute
      app.log.warn({ err: err.message }, "could not send the daily wird");
    }
  }
  return sent;
}

function startWirdLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "wird loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Today's portion is marked done if its time already passed (so turning on at night doesn't post late). */
function skipIfPassed(state, chat, timeZone, now = Date.now()) {
  const entry = get(state, chat);
  if (!entry) return;
  const { day, minutes } = zoneNow(timeZone, now);
  store(state).update(() => (entry.done = minutes >= parseClock(entry.time || DEFAULT_TIME) ? day : null));
}

module.exports = { setFetcher, pagesAr, pageText, portion, formatPortion, get, set, remove, setPosition, takePortion, runDue, startWirdLoop, skipIfPassed, TOTAL_PAGES, MAX_PAGES, DEFAULT_TIME };
