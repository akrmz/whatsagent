"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const quran = require("../src/services/quran");
const { HttpError } = require("../src/core/http");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  const dispatcher = createDispatcher(app);
  const send = (text) => dispatcher.handleMessage(sock, makeMsg({ text, sender: USER, chat: USER }));
  const last = () => sock.sent.filter((s) => !s.content.react).at(-1)?.content?.text || "";
  return { send, last };
}

test("surah names: Arabic with or without diacritics, other names, English spellings", () => {
  const n = (q) => quran.findSurah(q)?.number ?? null;
  assert.equal(quran.surahs().length, 114);
  assert.equal(quran.surahs().reduce((a, s) => a + s.numberOfAyahs, 0), 6236);
  for (const s of quran.surahs()) {
    assert.equal(n(s.name), s.number, s.name);
    assert.equal(n(s.englishName), s.number, s.englishName);
  }
  assert.deepEqual(
    ["الكهف", "الْكَهْف", "سورة الكهف", "كهف", "آل عمران", "ياسين", "تبارك", "عم", "الإسراء", "baqarah", "yasin", "kauthar", "quraysh", "nas", "nisa", "al fatihah", "lahab"].map(n),
    [18, 18, 18, 18, 3, 36, 67, 78, 17, 2, 36, 108, 106, 114, 4, 1, 111],
  );
  assert.equal(n("hello"), null);
  assert.equal(n("115"), null);
});

test("verse references by number or name; verse counts are checked", () => {
  const ref = (t) => quran.parseRef(t)?.ref ?? null;
  assert.deepEqual(
    ["2:255", "٢:٢٥٥", "2 255", "البقرة 255", "سورة البقرة ٢٥٥", "Al-Kahf 10", "الكهف", "yaseen 1"].map(ref),
    ["2:255", "2:255", "2:255", "2:255", "2:255", "18:10", "18:1", "36:1"],
  );
  assert.equal(ref("255"), null);
  assert.equal(ref("good morning"), null);
  assert.throws(() => quran.parseRef("الفاتحة 8"), /7 آية/);
  assert.equal(ref("115:1"), null, "no such surah: not a reference, no crash");
});

test(".qsearch sends the word without diacritics to the right edition and pages the results", async (t) => {
  const urls = [];
  const fake = (count) => ({
    data: {
      count,
      matches: Array.from({ length: count }, (_, i) => ({ surah: { number: 2, name: "سُورَةُ البَقَرَةِ" }, numberInSurah: i + 1, text: `آية فيها الصبر ${i + 1}` })),
    },
  });
  quran.setFetcher(async (url) => {
    urls.push(url);
    if (url.includes("zzz")) throw new HttpError("not found", { status: 404 });
    return fake(url.includes("en.sahih") ? 3 : 12);
  });
  t.after(() => quran.setFetcher(null));
  const bot = realBot();

  await bot.send(".qsearch الصَّبْر");
  assert.ok(urls[0].endsWith(`/search/${encodeURIComponent("الصبر")}/all/quran-simple-clean`), urls[0]);
  assert.match(bot.last(), /"الصَّبْر"\* — ١٢ نتيجة \(صفحة ١ من ٢\)/);
  assert.match(bot.last(), /• \*البقرة\* 2:1\n/);
  assert.match(bot.last(), /qsearch الصَّبْر 2/);
  await bot.send(".qsearch الصبر ٢");
  assert.match(bot.last(), /صفحة ٢ من ٢/);
  assert.match(bot.last(), /2:11/);
  await bot.send(".qsearch الصبر 5");
  assert.match(bot.last(), /صفحات فقط/);
  await bot.send(".qsearch patience");
  assert.ok(urls.at(-1).endsWith("/search/patience/all/en.sahih"));
  await bot.send(".qsearch zzz");
  assert.match(bot.last(), /No results/);
});

test(".quran and .tafsir accept surah names", async (t) => {
  const urls = [];
  quran.setFetcher(async (url) => {
    urls.push(url);
    return { data: [{ text: "آية", surah: { name: "سُورَةُ الكَهۡفِ", number: 18 }, numberInSurah: 10 }, { text: "تفسير" }] };
  });
  t.after(() => quran.setFetcher(null));
  const bot = realBot();
  await bot.send(".tafsir الكهف 10");
  assert.ok(urls.at(-1).includes("/ayah/18:10/"), urls.at(-1));
  assert.match(bot.last(), /التفسير الميسر/);
  await bot.send(".tafsir الفاتحة 9");
  assert.match(bot.last(), /7 آية/);
  await bot.send(".quran nothing here");
  assert.match(bot.last(), /qsearch/, "points to the search");
});
