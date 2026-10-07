"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const qq = require("../src/services/quranquiz");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const A = "447911123456@s.whatsapp.net";
const B = "447911654321@s.whatsapp.net";
const GROUP = "120363000000000008@g.us";

/** Fake alquran.cloud: a surah opener, a very long verse, then al-Kafirun 109:4. */
function fakeVerses() {
  const answers = [
    { surah: { number: 2 }, numberInSurah: 1, text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ الٓمٓ" },
    { surah: { number: 2 }, numberInSurah: 282, text: "ا".repeat(900) },
    { surah: { number: 109 }, numberInSurah: 4, text: "وَلَآ أَنَا۠ عَابِدٌۭ مَّا عَبَدتُّمْ" },
  ];
  let i = 0;
  qq.setFetcher(async () => ({ data: answers[Math.min(i++, answers.length - 1)] }));
}

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: A }, { id: B }] });
  app.sock = sock;
  const d = createDispatcher(app);
  const send = (text, sender) => d.handleMessage(sock, makeMsg({ text, chat: GROUP, sender }));
  const texts = () => sock.sent.filter((s) => s.content.text).map((s) => s.content.text);
  return { app, sock, send, texts };
}

test("choices: the answer, two neighbours, one anywhere; always 4 different surahs", () => {
  for (const correct of [1, 2, 57, 113, 114]) {
    for (let k = 0; k < 20; k++) {
      const o = qq.options(correct);
      assert.equal(o.length, 4);
      assert.equal(new Set(o).size, 4);
      assert.ok(o.includes(correct));
      assert.ok(o.every((n) => Number.isInteger(n) && n >= 1 && n <= 114));
      assert.ok(o.filter((n) => n !== correct && Math.abs(n - correct) <= 6).length >= 2, "two near it in the mushaf");
    }
  }
});

test(".quranquiz: skips verses that give the answer away; one try each; first right answer wins", async (t) => {
  fakeVerses();
  t.after(() => qq.setFetcher(null));
  const b = bot();
  await b.send(".quranquiz", A);
  const q = b.texts().at(-1);
  assert.match(q, /من أي سورة هذه الآية؟/);
  assert.match(q, /﴿وَلَآ أَنَا۠ عَابِدٌۭ مَّا عَبَدتُّمْ﴾/, "the surah opener and the 900-character verse were skipped");
  const round = qq.active(GROUP);
  const right = String(round.options.indexOf(109) + 1);
  const wrong = String(((round.options.indexOf(109) + 1) % 4) + 1);

  await b.send(".mathquiz", A);
  assert.match(b.texts().at(-1), /Quran quiz question is running/, "one number game at a time");

  await b.send(wrong, A);
  assert.equal(b.sock.sent.at(-1).content.react?.text, "❌");
  await b.send(right, A);
  assert.ok(qq.active(GROUP), "A already used their try");
  await b.send(right.replace(/\d/, (d) => "٠١٢٣٤٥٦٧٨٩"[d]), B); // in Arabic digits
  assert.match(b.texts().at(-1), /✅ @447911654321 أصاب .*سورة \*الكافرون\* \(109:4\) \(\+١، المجموع ١\)/);
  assert.equal(qq.active(GROUP), null);

  await b.send(".quranquiz top", A);
  assert.match(b.texts().at(-1), /١\. @447911654321 — ١/);
});

test("time's up: the round ends and nobody can win it afterwards", async (t) => {
  fakeVerses();
  t.after(() => qq.setFetcher(null));
  const round = await qq.start("chat-x");
  assert.equal(await qq.start("chat-x"), null, "one round per chat");
  const right = String(round.options.indexOf(109) + 1);
  assert.equal(qq.answer("chat-x", A, right, round.started + qq.ROUND_MS + 1), null, "too late");
  assert.equal(qq.expire("chat-x", round), true);
  assert.equal(qq.answer("chat-x", B, right), null);
  assert.match(qq.reveal(round), /الكافرون/);
});
