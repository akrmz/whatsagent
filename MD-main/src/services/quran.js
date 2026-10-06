"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const http = require("../core/http");
const { HttpError } = http;
const { UserError } = require("../core/errors");

/** Quran verses with al-Tafsir al-Muyassar from alquran.cloud (used by .tafsir and .autotafsir). */

// Replaceable in tests (offline fixtures).
let getJson = http.getJson;
const setFetcher = (fn) => (getJson = fn || http.getJson);

const API = "https://api.alquran.cloud/v1";
const TOTAL_AYAHS = 6236;

/**
 * @param {string|number} ref "2:255", or a verse number in the whole Quran (1–6236)
 * @returns {Promise<string>} the message text
 */
async function ayahWithTafsir(ref) {
  let res;
  try {
    res = await getJson(`${API}/ayah/${ref}/editions/quran-uthmani,ar.muyassar`, { timeoutMs: 15000 });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) throw new UserError(`لا توجد الآية ${ref}.`);
    throw err;
  }
  const [ayah, tafsir] = res.data || [];
  if (!ayah?.text) throw new UserError(`لا توجد الآية ${ref}.`);
  return `📖 *${ayah.surah.name}* ${ayah.surah.number}:${ayah.numberInSurah}\n\n﴿${ayah.text.trim()}﴾\n\n📝 *التفسير الميسر:*\n${tafsir?.text || ""}`;
}

const randomAyahTafsir = () => ayahWithTafsir(1 + crypto.randomInt(TOTAL_AYAHS));

// ---- Surah names and references (offline: assets/quran-surahs.json from alquran.cloud /meta) ----

let surahList;
const surahs = () => (surahList ||= require(path.join(__dirname, "..", "..", "assets", "quran-surahs.json")).surahs);

/** Arabic letters only, for matching names typed with or without diacritics, "ال" or "سورة". */
const bare = (s) =>
  String(s)
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^(سوره)\s*/, "")
    .replace(/^ال/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
/** "Al-Baqara" → "baqara"; "An-Naas" → "naas" (the article, however it is assimilated). */
const latin = (s) =>
  String(s)
    .toLowerCase()
    .replace(/^(surat?|sura|surah)\s+/, "")
    .replace(/^a[lnrstdzh]{1,2}[\s-]+/, "")
    .replace(/[^a-z]/g, "");
/** Long vowels and doubled letters folded: naas → "nas", yaseen → "yasin", fatihah → "fatiha". */
const loose = (s) =>
  latin(s)
    .replace(/h$/, "")
    .replace(/ee/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/(.)\1+/g, "$1");
/** Consonant skeleton for spellings that differ in vowels: baqarah / baqara → "bqr", kauthar / kawthar → "kthr". */
const skeleton = (s) =>
  loose(s)
    .replace(/(?!^)[yw]/g, "")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");

/** Other well-known names of some surahs. */
const ALIASES = { ياسين: 36, تبارك: 67, عم: 78, الدهر: 76, "بني اسرائيل": 17, الاسراء: 17, المؤمن: 40, براءه: 9, "حم السجده": 41, تبت: 111, لهب: 111 };
const EN_ALIASES = { lahab: 111, tabbat: 111, bani: 17 };
const ALIAS_KEYS = new Map(Object.entries(ALIASES).map(([k, v]) => [bare(k), v]));

/** A surah by number, Arabic name (with or without diacritics), a known other name, or English name. */
function findSurah(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  if (/^\d{1,3}$/.test(q)) return surahs()[Number(q) - 1] || null;
  const b = bare(q);
  const byArabic = surahs().find((s) => bare(s.name.replace(/^سُورَةُ\s*/, "")) === b);
  if (byArabic) return byArabic;
  if (ALIAS_KEYS.has(b)) return surahs()[ALIAS_KEYS.get(b) - 1];
  const en = latin(q);
  if (!en) return null;
  if (EN_ALIASES[en]) return surahs()[EN_ALIASES[en] - 1];
  const exact = surahs().find((s) => latin(s.englishName) === en) || surahs().find((s) => loose(s.englishName) === loose(q));
  if (exact) return exact;
  const sk = skeleton(q);
  const close = surahs().filter((s) => skeleton(s.englishName) === sk);
  return close.length === 1 ? close[0] : null; // ambiguous ("nas": an-Naas or an-Nisaa) → no guess
}

/**
 * "2:255", "البقرة 255", "baqarah 255", "الكهف" (verse 1) → { surah, ayah, ref: "2:255" }.
 * @returns {null | { surah: object, ayah: number, ref: string }} null when it isn't a reference
 * @throws {UserError} for a surah without that many verses
 */
function parseRef(text) {
  const t = String(text || "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .trim();
  let m = t.match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})$/);
  let surah;
  let ayah;
  if (m) {
    surah = surahs()[Number(m[1]) - 1];
    ayah = Number(m[2]);
  } else {
    m = t.match(/^(.+?)\s*[: ]\s*(\d{1,3})$/) || [null, t, "1"];
    surah = findSurah(m[1]);
    ayah = Number(m[2]);
  }
  if (!surah) return null;
  if (ayah < 1 || ayah > surah.numberOfAyahs) {
    throw new UserError(`${surah.name} (${surah.number}) فيها ${surah.numberOfAyahs} آية. — Surah ${surah.number} has ${surah.numberOfAyahs} verses.`);
  }
  return { surah, ayah, ref: `${surah.number}:${ayah}` };
}

/**
 * Searches the Quran text (Arabic, without diacritics) or the Sahih International translation.
 * @returns {Promise<{ count: number, matches: Array<{ surah: number, surahName: string, ayah: number, text: string }> }>}
 */
async function search(query) {
  const arabic = /[؀-ۿ]/.test(query);
  // The simple-clean edition has no diacritics, so they are removed from the query too.
  const q = (arabic ? String(query).replace(/[ً-ٰٟۖ-ۭـ]/g, "") : String(query)).trim();
  if (q.length < 2 || q.length > 50) throw new UserError("اكتب كلمة للبحث (من 2 إلى 50 حرفاً). — Search for 2–50 characters.");
  let res;
  try {
    res = await getJson(`${API}/search/${encodeURIComponent(q)}/all/${arabic ? "quran-simple-clean" : "en.sahih"}`, { timeoutMs: 20000 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return { count: 0, matches: [], arabic };
    throw err;
  }
  const matches = (res.data?.matches || []).map((x) => ({ surah: x.surah.number, surahName: x.surah.name, ayah: x.numberInSurah, text: x.text }));
  return { count: res.data?.count ?? matches.length, matches, arabic };
}

/** "سُورَةُ البَقَرَةِ" → "البقرة". */
const plainName = (name) =>
  String(name)
    .replace(/^سُورَةُ\s*/, "")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "");

module.exports = { setFetcher, ayahWithTafsir, randomAyahTafsir, surahs, findSurah, parseRef, search, bare, plainName, TOTAL_AYAHS };
