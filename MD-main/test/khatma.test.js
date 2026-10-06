"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const khatma = require("../src/services/khatma");
const jumuah = require("../src/services/jumuah");
const { stopAll } = require("../src/services/automations");
const { at } = require("../src/services/targets");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const A = "447911123456@s.whatsapp.net";
const B = "447911654321@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000002@g.us";

function realBot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: A }, { id: B }] });
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, send, last };
}

test("juz data: 30 parts covering pages 1-604, from the bundled alquran.cloud metadata", () => {
  assert.equal(khatma.juzInfo(1).pages[0], 1);
  assert.equal(khatma.juzInfo(30).pages[1], 604);
  assert.deepEqual([khatma.juzInfo(2).surah, khatma.juzInfo(2).ayah], [2, 142]);
  assert.deepEqual([khatma.juzInfo(30).surah, khatma.juzInfo(30).ayah], [78, 1]);
  for (let n = 2; n <= 30; n++) assert.ok(khatma.juzInfo(n).pages[0] >= khatma.juzInfo(n - 1).pages[1], `juz ${n} after juz ${n - 1}`);
  assert.match(khatma.partLine(5), /^الجزء ٥ — النساء ٢٤ \(ص ٨٢–١٠١\)$/);
});

test("a group khatma: take, conflicts, limits, done, finish", () => {
  const t = realBot();
  const s = t.app.state;
  assert.throws(() => khatma.take(s, GROUP, A), /لا توجد ختمة/);
  khatma.start(s, GROUP);
  assert.equal(khatma.take(s, GROUP, A), 1, "first free part");
  assert.equal(khatma.take(s, GROUP, B, 5), 5);
  assert.throws(() => khatma.take(s, GROUP, A, 5), /محجوز/);
  assert.throws(() => khatma.take(s, GROUP, A, 31), /من 1 إلى 30/);
  khatma.take(s, GROUP, A, 2);
  khatma.take(s, GROUP, A, 3);
  assert.throws(() => khatma.take(s, GROUP, A, 4), /أتمّ واحداً أولاً/, "at most 3 open parts");
  assert.throws(() => khatma.done(s, GROUP, A), /أكثر من جزء/);
  assert.throws(() => khatma.done(s, GROUP, A, 5), /لعضو آخر/);
  assert.equal(khatma.done(s, GROUP, ADMIN, 5, { manager: true }).n, 5, "a manager may mark anyone's");
  assert.equal(khatma.get(s, GROUP).parts[5].by, B, "still credited to the reader");
  khatma.drop(s, GROUP, A, 3);
  assert.equal(khatma.get(s, GROUP).parts[3], undefined);

  const b = khatma.board(khatma.get(s, GROUP), at);
  assert.match(b.text, /✅ ٥ — @447911654321/);
  assert.match(b.text, /📖 ١ — @447911123456/);
  assert.ok(b.mentions.includes(A) && b.mentions.includes(B));

  let last;
  for (let n = 1; n <= 30; n++) if (!khatma.get(s, GROUP).parts[n]?.done) last = khatma.done(s, GROUP, ADMIN, n, { manager: true });
  assert.equal(last.finished, true);
  assert.equal(khatma.get(s, GROUP).completed, 1);
  assert.match(khatma.board(khatma.get(s, GROUP), at).text, /تمّت الختمة/);
  assert.equal(khatma.start(s, GROUP).round, 2, "the next round is numbered");
});

test(".khatma from chat", async () => {
  const t = realBot();
  await t.send({ text: ".khatma", chat: GROUP, sender: A });
  assert.match(t.last(), /لا توجد ختمة/);
  await t.send({ text: ".khatma new", chat: GROUP, sender: A });
  assert.match(t.last(), /بدأت ختمة جديدة/);
  await t.send({ text: ".khatma take ٧", chat: GROUP, sender: A });
  assert.match(t.last(), /حجزت \*الجزء ٧/);
  assert.match(t.last(), /wird page 121/);
  assert.deepEqual(t.sock.sent.at(-1).content.mentions, [A]);
  await t.send({ text: ".khatma take 7", chat: GROUP, sender: B });
  assert.match(t.last(), /❌ الجزء ٧ محجوز/);
  await t.send({ text: ".khatma done", chat: GROUP, sender: A });
  assert.match(t.last(), /الجزء ٧ مقروء. \(١\/٣٠\)/);
  await t.send({ text: ".khatma take", chat: GROUP, sender: B });
  await t.send({ text: ".khatma new", chat: GROUP, sender: B });
  assert.match(t.last(), /khatma new confirm/, "an unfinished khatma is not replaced by accident");
  await t.send({ text: ".autos", chat: GROUP, sender: A });
  assert.match(t.last(), /ختمة جماعية: ١\/٣٠/);
  await t.send({ text: ".khatma info 30", chat: GROUP, sender: A });
  assert.match(t.last(), /النبإ|النبأ/);
});

test("Friday reminder: due once on Friday at its time, up to 3 h late, never on other days", async () => {
  const zone = "Africa/Cairo";
  const fri = (hhmm) => Date.parse(`2026-10-09T${hhmm}:00+03:00`); // Cairo is UTC+3 in October 2026
  const e = { time: "09:00" };
  assert.equal(jumuah.isDue(e, zone, fri("08:59")), false);
  assert.equal(jumuah.isDue(e, zone, fri("09:00")), true);
  assert.equal(jumuah.isDue(e, zone, fri("11:30")), true, "bot was offline: still sent");
  assert.equal(jumuah.isDue(e, zone, fri("12:30")), false, "too late");
  assert.equal(jumuah.isDue(e, zone, Date.parse("2026-10-08T09:30:00+03:00")), false, "Thursday");
  assert.equal(jumuah.isDue({ ...e, last: "2026-10-09" }, zone, fri("09:30")), false, "already sent");
  assert.deepEqual(jumuah.nextSend(e, zone, Date.parse("2026-10-06T09:00:00+03:00")), { day: "2026-10-09", time: "09:00", inMinutes: 3 * 1440 });
  assert.equal(jumuah.nextSend({ ...e, last: "2026-10-09" }, zone, fri("10:00")).day, "2026-10-16");

  const msg = jumuah.message("!");
  assert.ok(msg.includes(require("../assets/quran-juz-ar.json").friday.text), "62:9 as bundled from alquran.cloud");
  assert.match(msg, /\[الجمعة: ٩\]/);
  assert.match(msg, /!surah 18/);
  assert.ok(msg.includes(require("../src/services/azkar").chapterItems(23)[0].text), "salawat from Hisn al-Muslim");
  assert.doesNotMatch(msg, /\n\n\n/);

  const t = realBot();
  jumuah.set(t.app.state, GROUP, { time: "09:00" });
  assert.equal(await jumuah.runDue(t.app, fri("09:01")), 1);
  assert.equal(await jumuah.runDue(t.app, fri("09:02")), 0, "once per Friday");
  assert.equal(jumuah.get(t.app.state, GROUP).last, "2026-10-09");

  await t.send({ text: ".autojumuah on 10am", chat: GROUP, sender: A });
  assert.match(t.last(), /كل جمعة الساعة 10:00/);
  assert.deepEqual(stopAll(t.app.state, GROUP), ["autojumuah"]);
  assert.equal(jumuah.get(t.app.state, GROUP), null);
});
