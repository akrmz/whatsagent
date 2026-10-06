"use strict";

const crypto = require("node:crypto");
const { getJson, HttpError } = require("../core/http");
const { UserError } = require("../core/errors");

/** Quran verses with al-Tafsir al-Muyassar from alquran.cloud (used by .tafsir and .autotafsir). */

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

module.exports = { ayahWithTafsir, randomAyahTafsir, TOTAL_AYAHS };
