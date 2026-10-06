"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const azkar = require("../src/services/azkar");
const book = require("../assets/hisnmuslim-ar.json");
const { makeApp, makeSock, makeMsg, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

test("the bundled Hisn al-Muslim is complete and has its source", () => {
  assert.equal(book.chapters.length, 132);
  assert.equal(book.chapters.reduce((n, c) => n + c.items.length, 0), 267);
  assert.match(book.source, /حصن المسلم/);
  const morning = book.chapters.find((c) => c.id === 27);
  assert.equal(morning.title, "أذكار الصباح والمساء");
  assert.equal(morning.items.length, 24);
  // Ayat al-Kursi opens the morning/evening adhkar (checked letter by letter against alquran.cloud when bundled).
  // Compared without diacritics (their order inside a letter can differ between texts).
  const plain = morning.items[0].text.replace(/[ً-ْٰ]/g, "");
  assert.ok(plain.includes("الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم"));
});

test("morning and evening sets follow the book's own notes", () => {
  const morning = azkar.setText("morning");
  const evening = azkar.setText("evening");
  assert.match(morning, /^🌅 \*أذكار الصباح\*/);
  assert.match(evening, /^🌇 \*أذكار المساء\*/);
  assert.ok(morning.includes("إذا أصبحَ)"), "morning-only entries in the morning");
  assert.ok(!evening.includes("(مائةَ مرَّةٍ إذا أصبحَ)"), "morning-only entries not in the evening");
  assert.ok(evening.includes("إذا أمسى)."), "evening-only entry in the evening");
  assert.ok(!morning.includes("ثلاثَ مرَّاتٍ إذا أمسى"), "evening-only entry not in the morning");
  assert.match(azkar.setText("morning", { friday: true }), /سورة الكهف/);
  assert.ok(morning.length < 60000, "fits in one WhatsApp message");
  assert.equal(azkar.setFrom("المساء"), "evening");
  assert.equal(azkar.setFrom("sleep"), "sleep");
});

test("random duas are always supplications; topics search chapter titles", () => {
  for (let i = 0; i < 200; i++) assert.ok(azkar.randomDua().text.startsWith("(("));
  assert.match(azkar.randomDua("الكرب").title, /الكرب/);
  assert.equal(azkar.randomDua("كلمة غير موجودة"), null);
  assert.match(azkar.chapterText(35), /^📖 \*35\. دعاء الكرب\*/);
  assert.equal(azkar.chapterText(999), null);
});

test("daily adhkar: sent once at each time, and turning on later skips times already passed", async () => {
  const t = realBot();
  const zone = "Africa/Cairo";
  const at = (iso) => Date.parse(iso);
  azkar.setAuto(t.app.state, GROUP, { morning: "06:30", evening: "17:00", dua: "21:00" });
  await azkar.skipPassed(t.app.state, GROUP, zone, at("2026-10-06T09:00:00Z")); // 12:00 Cairo: morning passed
  assert.deepEqual(await azkar.dueFor(azkar.getAuto(t.app.state, GROUP), zone, at("2026-10-06T09:00:00Z")), []);

  assert.equal(await azkar.runDue(t.app, at("2026-10-06T14:05:00Z")), 1); // 17:05
  assert.match(t.last(), /^🌇 \*أذكار المساء\*/);
  assert.equal(await azkar.runDue(t.app, at("2026-10-06T14:10:00Z")), 0, "not twice");
  assert.equal(await azkar.runDue(t.app, at("2026-10-06T18:00:30Z")), 1); // 21:00
  assert.match(t.last(), /^🤲/);
  assert.equal(await azkar.runDue(t.app, at("2026-10-07T03:31:00Z")), 1); // next day 06:31
  assert.match(t.last(), /^🌅 \*أذكار الصباح\*/);
});

test(".autoazkar: admins in groups, anyone in their own chat; on/off and times", async () => {
  const t = realBot();
  await t.send({ text: ".autoazkar on", chat: GROUP, sender: USER });
  assert.match(t.last(), /المشرفون فقط/);
  await t.send({ text: ".autoazkar on", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /الأذكار اليومية\* \(on\)/);
  await t.send({ text: ".autoazkar evening 4:45pm", chat: GROUP, sender: ADMIN });
  assert.equal(azkar.getAuto(t.app.state, GROUP).evening, "16:45");
  await t.send({ text: ".autoazkar dua 21:00", chat: GROUP, sender: ADMIN });
  await t.send({ text: ".autoazkar dua off", chat: GROUP, sender: ADMIN });
  assert.equal(azkar.getAuto(t.app.state, GROUP).dua, null);
  await t.send({ text: ".autoazkar morning soon", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /اكتب الوقت/);
  await t.send({ text: ".autoazkar off", chat: GROUP, sender: ADMIN });
  assert.equal(azkar.getAuto(t.app.state, GROUP), null);
  await t.send({ text: ".autoazkar on", chat: USER });
  assert.ok(azkar.getAuto(t.app.state, USER), "anyone can turn it on for their private chat");
  await t.send({ text: ".azkar نوم", chat: USER });
  assert.match(t.last(), /^🌙 \*أذكار النوم\*/);
  await t.send({ text: `.dua`, chat: `${OWNER}@s.whatsapp.net` });
  assert.match(t.last(), /^🤲 \*/);
});
