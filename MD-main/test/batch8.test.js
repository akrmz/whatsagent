"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const wird = require("../src/services/wird");
const hadith = require("../src/services/hadith");
const gold = require("../src/services/gold");
const { makeApp, makeSock } = require("./helpers");

const CHAT = "120363000000000000@g.us";
const BASMALA = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

/** Fake alquran.cloud pages: page 1 = al-Fatiha, page n>1 = first verse of a surah n. */
function fakeQuran(url) {
  const page = Number(url.match(/\/page\/(\d+)\//)[1]);
  const surah = page === 1 ? { number: 1, name: "سُورَةُ ٱلْفَاتِحَةِ" } : { number: page, name: `سورة ${page}` };
  const text = page === 1 ? `${String.fromCharCode(0xfeff)}${BASMALA}` /* with a byte-order mark, as the API sends it */ : page === 187 ? "بَرَآءَةٌۭ مِّنَ ٱللَّهِ" : `${BASMALA} قُلْ هُوَ ٱللَّهُ أَحَدٌ`;
  return Promise.resolve({ data: { ayahs: [{ text, numberInSurah: 1, juz: Math.ceil(page / 20), surah }] } });
}

test("mushaf pages: basmala on its own line (not for al-Fatiha or at-Tawbah), Arabic verse numbers", async () => {
  wird.setFetcher(fakeQuran);
  try {
    const fatiha = await wird.pageText(1);
    assert.equal(fatiha.text, `🕋 *سُورَةُ ٱلْفَاتِحَةِ*\n${BASMALA} ﴿١﴾`, "basmala is verse 1 of al-Fatiha; the BOM is removed");
    const other = await wird.pageText(604);
    assert.equal(other.text, `🕋 *سورة 604*\n${BASMALA}\nقُلْ هُوَ ٱللَّهُ أَحَدٌ ﴿١﴾`);
    const tawbah = await wird.pageText(187);
    assert.doesNotMatch(tawbah.text, /بِسْمِ/);
  } finally {
    wird.setFetcher(null);
  }
});

test("daily wird: N pages a day in order, wraps after page 604 and counts the khatma", async () => {
  wird.setFetcher(fakeQuran);
  try {
    const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" } });
    app.sock = makeSock();
    app.health.state = "open";
    wird.set(app.state, CHAT, { pages: 2, time: "20:00" });
    assert.equal(await wird.runDue(app, Date.parse("2026-10-06T16:00:00Z")), 0, "19:00: not yet");
    assert.equal(await wird.runDue(app, Date.parse("2026-10-06T17:01:00Z")), 1, "20:01");
    assert.match(app.sock.sent.at(-1).content.text, /^📖 \*الورد اليومي\* — صفحة 1–2 من 604/);
    assert.equal(await wird.runDue(app, Date.parse("2026-10-06T17:30:00Z")), 0, "once a day");
    assert.equal(wird.get(app.state, CHAT).next, 3);

    wird.setPosition(app.state, CHAT, 604);
    const text = await wird.takePortion(app.state, CHAT);
    assert.match(text, /صفحة 604–1 من 604/);
    assert.match(text, /تم بحمد الله ختم القرآن الكريم/);
    assert.match(text, /التقدم: 100% · الختمات: 1/);
    assert.equal(wird.get(app.state, CHAT).next, 2);
    assert.deepEqual([1, 2, 3, 11].map(wird.pagesAr), ["صفحة واحدة", "صفحتان", "3 صفحات", "11 صفحة"]);
  } finally {
    wird.setFetcher(null);
  }
});

test("hadith: grade, source and explanation, with attribution", () => {
  const text = hadith.format({
    id: "2962",
    title: "أول ما يقضى بين الناس",
    hadeeth: "عن عبد الله بن مسعود …",
    grade: "صحيح",
    attribution: "متفق عليه",
    explanation: "ش".repeat(900),
  });
  assert.match(text, /^📜 \*أول ما يقضى بين الناس\*\n\nعن عبد الله بن مسعود …\n\n📌 الدرجة: صحيح · رواه: متفق عليه/);
  assert.ok(text.includes("…"), "long explanations are shortened");
  assert.match(text, /موسوعة الأحاديث النبوية — hadeethenc\.com \(2962\)/);
});

test("random hadith: categories weighted by size, item picked from the right page", async () => {
  const calls = [];
  hadith.setFetcher(async (url) => {
    calls.push(url);
    if (url.includes("categories/roots")) return [{ id: "3", hadeeths_count: "45" }];
    if (url.includes("hadeeths/list")) {
      const page = Number(url.match(/page=(\d+)/)[1]);
      return { data: Array.from({ length: 20 }, (_, i) => ({ id: String((page - 1) * 20 + i + 1) })) };
    }
    const id = url.match(/id=(\d+)/)[1];
    return { id, title: `t${id}`, hadeeth: "h", grade: "صحيح" };
  });
  try {
    const h = await hadith.randomHadith();
    assert.ok(Number(h.id) >= 1 && Number(h.id) <= 45);
    assert.ok(calls.some((u) => /category_id=3&page=[123]&per_page=20/.test(u)));
    assert.equal(await hadith.byId("../etc"), null, "ids are digits only");
  } finally {
    hadith.setFetcher(null);
  }
});

test("zakat: nisab by gold (85 g) and silver (595 g), 2.5 %", () => {
  const p = { gold24: 7000, silver: 100 }; // per gram
  const z = gold.zakat(300000, p);
  assert.equal(z.nisabGold, 595000);
  assert.equal(z.nisabSilver, 59500);
  assert.equal(z.due, 7500);
  assert.equal(z.aboveGold, false);
  assert.equal(z.aboveSilver, true);
  assert.equal(gold.zakat(600000, p).aboveGold, true);
});
