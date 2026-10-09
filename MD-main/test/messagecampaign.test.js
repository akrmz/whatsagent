"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const leads = require("../src/services/leads");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const GROUP = "120363000000000066@g.us";
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);
const jid = (p) => `${p}@s.whatsapp.net`;

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  leads.add(s, { name: "منى", phone: "201000000001", type: "شقة", deal: "بيع", location: "التجمع الخامس" }, ME); // #1 new
  const karim = leads.add(s, { name: "كريم", phone: "201000000002", type: "فيلا", location: "الشيخ زايد" }, ME); // #2
  leads.update(s, karim.id, { status: "won" });
  const sara = leads.add(s, { name: "سارة", phone: "201000000003", location: "التجمع" }, ME); // #3
  leads.update(s, sara.id, { status: "lost" });
  const ali = leads.add(s, { name: "علي", phone: "201000000004" }, ME); // #4
  leads.setOptOut(s, ali.id, true);
  leads.add(s, { name: "خالد" }, ME); // #5, no number
  return { app, sock, send, s, last: () => sock.sent.at(-1).content.text || "", to: (p) => sock.sent.filter((m) => m.jid === jid(p)) };
}

test(".blast msg: preview to everyone but lost clients, {name} filled, then paced sending with notes and a summary", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-10", "12:00") });
  const b = bot();
  await b.send(".blast msg");
  assert.match(b.last(), /^✉️ \*A message to your clients\*/, "how to use it");

  await b.send(".blast msg\nكل سنة وانت طيب يا {name} 🌙 رمضان كريم");
  const preview = b.last();
  assert.match(preview, /^✉️ \*Message preview\* — everyone but lost\n\nGoes to 2 client\(s\):\n▫️ #1 منى \(\+201000000001\)\n▫️ #2 كريم \(\+201000000002\)\n/);
  assert.match(preview, /#1 reads:\n┈┈┈┈┈┈┈┈\nكل سنة وانت طيب يا منى 🌙 رمضان كريم\n\nلإيقاف رسائل العروض أرسل: وقف\n┈┈┈┈┈┈┈┈/);
  assert.equal(b.to("201000000001").length, 0, "nothing sent before go");

  await b.send(".blast msg go");
  assert.match(b.last(), /^▶️ Message #\d+ started: 2 client\(s\)\./);
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "12:01"), () => 0), "sent");
  assert.equal(b.to("201000000001").at(-1).content.text, "كل سنة وانت طيب يا منى 🌙 رمضان كريم\n\nلإيقاف رسائل العروض أرسل: وقف");
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "12:01"), () => 0), "gap");
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "12:03"), () => 0), "sent");
  assert.match(b.to("201000000002").at(-1).content.text, /^كل سنة وانت طيب يا كريم/);
  assert.match(b.last(), /^📣 رسالة #\d+ للعملاء: ✅ 2 أُرسلت من 2/, "the summary comes back here");
  for (const p of ["201000000003", "201000000004"]) assert.equal(b.to(p).length, 0, `${p}: lost or said stop`);
  const mona = leads.byPhone(b.s, "201000000001");
  assert.match(mona.history.at(-1).text, /^أُرسلت له رسالة \(#\d+\): كل سنة وانت طيب يا \{name\}/);
  assert.equal(mona.lastSentAt, undefined, "not a listing: no reply tracking or follow-up starts");

  await b.send(".blast msg go");
  assert.match(b.last(), /Nothing to send/, "a draft is used once");
  t.mock.timers.reset();
});

test("filters: area and type, a status, all; and the checks", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-10", "12:00") });
  const b = bot();
  await b.send(".blast msg التجمع شقة\nعندنا وحدات جديدة في التجمع الخامس، تحب أبعتلك التفاصيل؟");
  assert.match(b.last(), /— everyone but lost · شقة · area: التجمع\n\nGoes to 1 client\(s\):\n▫️ #1 منى/);
  await b.send(".blast msg won\nشكراً لثقتك يا {name}");
  assert.match(b.last(), /— won\n\nGoes to 1 client\(s\):\n▫️ #2 كريم/);
  await b.send(".blast msg all التجمع\nأهلاً {name}");
  assert.match(b.last(), /Goes to 2 client\(s\):\n▫️ #1 منى[^\n]*\n▫️ #3 سارة/, "all: lost clients too");
  await b.send(".blast msg إيجار\nعندي شقق للإيجار");
  assert.match(b.last(), /No client matches \(everyone but lost · إيجار\)/);
  await b.send(`.blast msg\n${"ا".repeat(1001)}`);
  assert.match(b.last(), /at most 1000 characters/);

  await b.send(".blast msg\nأهلاً", { chat: GROUP });
  assert.match(b.last(), /^🔒/, "client names in the preview: not in a mixed group");

  await b.send(".blast msg\nأول رسالة");
  await b.send(".blast msg go");
  await b.send(".blast msg\nتاني رسالة");
  await b.send(".blast msg go");
  assert.match(b.last(), /already being sent/, "one message campaign at a time");
  t.mock.timers.setTime(Date.now() + 16 * 60 * 1000);
  await b.send(".blast msg go");
  assert.match(b.last(), /Nothing to send/, "drafts last 15 minutes");
  t.mock.timers.reset();
});

test("a picture goes with every message and is deleted when the campaign ends; a stop request on the way is honoured", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-10", "12:00") });
  const b = bot();
  const name = "test-picture.jpg";
  const file = campaigns.imagePath(b.app.config, name);
  fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const c = campaigns.startMessage(b.s, { by: ME, chat: ME, text: "عيد سعيد يا {name} 🎉", image: name, audience: campaigns.parseAudience("") });
  assert.deepEqual(c.queue, [1, 2]);
  leads.setOptOut(b.s, 2, true); // Karim says stop before his turn
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "12:01"), () => 0), "sent");
  const sent = b.to("201000000001").at(-1).content;
  assert.ok(Buffer.isBuffer(sent.image));
  assert.equal(sent.caption, "عيد سعيد يا منى 🎉\n\nلإيقاف رسائل العروض أرسل: وقف");
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "12:03"), () => 0), "done");
  assert.equal(b.to("201000000002").length, 0);
  assert.match(b.last(), /✅ 1 أُرسلت · ⏭️ 1 تخطي من 2/);
  assert.equal(fs.existsSync(file), false, "the picture is deleted when it's done");
  t.mock.timers.reset();
});

test("ready greetings fill {name} and {agent}; a message can wait for a date and time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-10", "12:00") });
  const b = bot();
  const re = require("../src/services/realestate");
  re.setAgent(b.s, "name", "أحمد");
  re.setAgent(b.s, "company", "دار للتسويق");
  await b.send(".blast msg رمضان");
  assert.match(b.last(), /#1 reads:\n┈┈┈┈┈┈┈┈\nرمضان كريم يا منى 🌙\nكل سنة وانت طيب، وربنا يتقبل منا ومنكم صالح الأعمال\.\n— أحمد · دار للتسويق\n\nلإيقاف رسائل العروض أرسل: وقف\n/);
  assert.equal(campaigns.messageText({}, campaigns.occasion("عيد الأضحى"), {}), "عيد أضحى مبارك 🐑\nكل سنة وانت طيب، وينعاد عليك وعلى عيلتك بالخير.\n\nلإيقاف رسائل العروض أرسل: وقف", "no name, no agent: nothing dangling");

  await b.send(".blast msg go someday");
  assert.match(b.last(), /When\? e\.g\./);
  await b.send(".blast msg go 2026-10-01 09:00");
  assert.match(b.last(), /from a minute to 60 days from now/);
  await b.send(".blast msg go 15/10 09:30");
  assert.match(b.last(), /^🕒 Message #\d+ to 2 client\(s\) is scheduled for /);
  const c = campaigns.running(b.s)[0];
  assert.equal(c.startAt, at("2026-10-15", "09:30"));
  await b.send(".campaigns");
  assert.match(b.last(), /🕒 يبدأ الخميس، 15 أكتوبر/);
  assert.equal(await campaigns.tick(b.app, at("2026-10-12", "12:00"), () => 0), "idle", "waits for its day");
  assert.equal(await campaigns.tick(b.app, at("2026-10-15", "09:45"), () => 0), "hours", "and for the sending hours");
  assert.equal(await campaigns.tick(b.app, at("2026-10-15", "10:00"), () => 0), "sent");
  assert.match(b.to("201000000001").at(-1).content.text, /^رمضان كريم يا منى 🌙/);

  await b.send(".blast msg\nأهلاً {name}");
  await b.send(".blast msg go 20/09 09:00");
  assert.match(b.last(), /from a minute to 60 days/, "20/09 has passed this year: next year is too far");
  t.mock.timers.reset();
});
