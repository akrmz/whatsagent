"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { parseWhen, arabicTime } = require("../src/services/reminders");
const autoreply = require("../src/services/autoreply");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const CLIENT2 = "201077776666@s.whatsapp.net";
const GROUP = "120363000000000011@g.us";

test("Arabic times for reminders, follow-ups and viewings", () => {
  const thu10 = Date.parse("2026-10-08T10:00:00+03:00"); // a Thursday, 10:00 in Cairo
  const at = (t) => {
    const r = parseWhen(t, "Africa/Cairo", thu10);
    return r && [new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(thu10 + r.ms)), r.rest, r.every / 3600000];
  };
  assert.deepEqual(at("بكرة الساعة 4 م اتصل بأحمد"), ["Fri 16:00", "اتصل بأحمد", 0]);
  assert.deepEqual(at("غدا 16:00"), ["Fri 16:00", "", 0]);
  assert.deepEqual(at("يوم الجمعة الساعة 6 مساءً"), ["Fri 18:00", "", 0], "the tanween in مساءً is part of the word");
  assert.deepEqual(at("بعد ساعتين"), ["Thu 12:00", "", 0]);
  assert.deepEqual(at("بعد 3 أيام راجع العقد"), ["Sun 10:00", "راجع العقد", 0]);
  assert.deepEqual(at("بعد نص ساعة"), ["Thu 10:30", "", 0]);
  assert.deepEqual(at("النهارده ٩ مساءً اجتماع"), ["Thu 21:00", "اجتماع", 0], "Arabic digits");
  assert.deepEqual(at("كل يوم 8 ص أذكار"), ["Fri 08:00", "أذكار", 24]);
  assert.deepEqual(at("الساعة 1 الضهر"), ["Thu 13:00", "", 0]);
  assert.equal(parseWhen("يرد على العرض يوم الخميس", "Africa/Cairo", thu10), null, "a note that mentions a day isn't a time");
  assert.equal(arabicTime("يرد على العرض يوم الخميس"), "يرد على العرض يوم الخميس", "text after the time is never changed");
  assert.deepEqual(at("tomorrow at 4pm"), ["Fri 16:00", "", 0], "English as before");
});

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = from } = {}) =>
    d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  const sentTo = (jid) => sock.sent.filter((s) => s.jid === jid && s.content.text).map((s) => s.content.text);
  return { app, sock, send, sentTo };
}

test("welcome on the first message only; away outside working hours, once per 12 h; never in groups or to staff", async (t) => {
  const b = bot();
  await b.send("hello before greet", { from: CLIENT2 });
  assert.deepEqual(b.sentTo(CLIENT2), [], "nothing is on");
  await b.send(".greet on أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله");
  await b.send(".awaymsg on شكراً لتواصلك، سنرد عليك قريباً");
  await b.send(".awaymsg hours 10:00-22:00");

  // Inside working hours: only the welcome, once.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T12:00:00+03:00") });
  await b.send("السلام عليكم", { from: CLIENT });
  await b.send("عندي سؤال", { from: CLIENT });
  assert.deepEqual(b.sentTo(CLIENT), ["أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله"]);

  // At night: the away note, once per 12 hours. A new person gets both in one message.
  t.mock.timers.setTime(Date.parse("2026-10-08T23:30:00+03:00"));
  await b.send("لسه صاحي؟", { from: CLIENT });
  await b.send("؟", { from: CLIENT });
  assert.equal(b.sentTo(CLIENT).length, 2);
  assert.equal(b.sentTo(CLIENT)[1], "شكراً لتواصلك، سنرد عليك قريباً");
  await b.send("مساء الخير", { from: "201055554444@s.whatsapp.net" });
  assert.deepEqual(b.sentTo("201055554444@s.whatsapp.net"), ["أهلاً بك في دار للتسويق العقاري 🏡 أرسل #رقم العقار لتفاصيله\n\nشكراً لتواصلك، سنرد عليك قريباً"]);
  assert.deepEqual(b.sentTo(CLIENT2), [], "people who wrote before greet was on aren't greeted later");

  const groupBefore = b.sock.sent.length;
  await b.send("hi all", { from: "201044443333@s.whatsapp.net", chat: GROUP });
  assert.equal(b.sock.sent.length, groupBefore, "groups: never");
  await b.send("note to self");
  assert.deepEqual(b.sentTo(ME).filter((x) => /شكراً لتواصلك/.test(x) && !/Away message/.test(x)), [], "the owner: never");
  t.mock.timers.reset();
});

test("greeted people are stored as fingerprints, not phone numbers", () => {
  const b = bot();
  autoreply.setGreet(b.app.state, "hi");
  assert.equal(autoreply.replyFor(b.app.state, CLIENT, "UTC"), "hi");
  assert.equal(autoreply.replyFor(b.app.state, CLIENT, "UTC"), null);
  b.app.state.flush();
  const file = fs.readFileSync(path.join(b.app.config.paths.data, "autoreply.json"), "utf8");
  assert.doesNotMatch(file, /201099998888/);
  assert.match(file, /"seen":\s*\{\s*"[0-9a-f]{32}"/);
  assert.equal(autoreply.withinHours("10:00-22:00", 12 * 60), true);
  assert.equal(autoreply.withinHours("10:00-22:00", 23 * 60), false);
  assert.equal(autoreply.withinHours("20:00-04:00", 1 * 60), true, "working hours across midnight");
});

test("the greeted list stays bounded: the oldest are dropped in batches, recent ones kept", () => {
  const b = bot();
  const s = b.app.state;
  // The 51,001st person takes the list over 50,000 + 1,000: it is trimmed back to 50,000.
  for (let i = 0; i < 51001; i++) autoreply.firstContact(s, `${2010000000000 + i}@s.whatsapp.net`, i);
  const seen = s.store("autoreply", {}).data.seen;
  assert.equal(Object.keys(seen).length, 50000, "trimmed back to 50,000 once over by 1,000");
  assert.equal(autoreply.firstContact(s, `${2010000000000 + 51000}@s.whatsapp.net`), false, "the newest is still known");
  assert.equal(autoreply.firstContact(s, `${2010000000000 + 0}@s.whatsapp.net`), true, "the oldest was dropped");
  const other = bot(); // another bot in the same process keeps its own count
  assert.equal(autoreply.firstContact(other.app.state, "201099998888@s.whatsapp.net"), true);
  assert.equal(Object.keys(other.app.state.store("autoreply", {}).data.seen).length, 1);
});

test("the Arabic guide shows which steps are done and what's next", async () => {
  const b = bot();
  await b.send(".rehelp");
  const first = b.sentTo(ME).at(-1);
  assert.match(first, /دليل أدوات العقارات/);
  assert.match(first, /⬜ \*١\. بياناتك\*[\s\S]*👈 \*الخطوة التالية\*/);
  await b.send(".agent name أحمد");
  await b.send(".agent phone 0100");
  await b.send(".listing add شقة للبيع في التجمع 150 متر بسعر 3 مليون");
  await b.send(".rehelp");
  const second = b.sentTo(ME).at(-1);
  assert.match(second, /✅ \*١\. بياناتك\*/);
  assert.match(second, /✅ \*٢\. أضف عقاراً\*/);
  assert.match(second, /⬜ \*٣\. عملاؤك\*[^⬜✅]*👈 \*الخطوة التالية\*/);
  await b.send(".rehelp", { from: CLIENT });
  assert.equal(b.sentTo(CLIENT).some((x) => /دليل أدوات/.test(x)), false, "for the owner and sudo users");
});
