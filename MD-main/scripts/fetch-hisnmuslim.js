"use strict";

/**
 * Downloads the Arabic text of Hisn al-Muslim (حصن المسلم, Sa'id ibn Ali ibn Wahf
 * al-Qahtani) from the official hisnmuslim.com API and writes assets/hisnmuslim-ar.json.
 * The bot reads that file; it never calls the website itself.
 *
 *   node scripts/fetch-hisnmuslim.js
 *
 * Run it only to refresh the bundled copy, then review the diff before committing.
 */

const fs = require("node:fs");
const path = require("node:path");
const { request } = require("../src/core/http");

/** The API answers with a byte-order mark before the JSON. */
async function getJson(url) {
  const text = (await request(url, { timeoutMs: 30000, maxBytes: 5 * 1024 * 1024 })).body.toString("utf8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

const BASE = "https://www.hisnmuslim.com/api/ar";
const OUT = path.join(__dirname, "..", "assets", "hisnmuslim-ar.json");

const clean = (s) =>
  String(s ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();

async function main() {
  const index = Object.values(await getJson(`${BASE}/husn_ar.json`))[0];
  const chapters = [];
  for (const ch of index) {
    const id = Number(ch.ID);
    const data = Object.values(await getJson(`${BASE}/${id}.json`))[0];
    chapters.push({
      id,
      title: clean(ch.TITLE),
      items: data.map((x) => ({ id: Number(x.ID), text: clean(x.ARABIC_TEXT), repeat: Number(x.REPEAT) || 1 })),
    });
    process.stdout.write(".");
  }
  chapters.sort((a, b) => a.id - b.id);
  const out = {
    source: "حصن المسلم من أذكار الكتاب والسنة — سعيد بن علي بن وهف القحطاني (hisnmuslim.com). حقوق الطبع لكل مسلم.",
    url: "https://www.hisnmuslim.com",
    retrieved: new Date().toISOString().slice(0, 10),
    chapters,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\n${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.items.length, 0)} adhkar → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
