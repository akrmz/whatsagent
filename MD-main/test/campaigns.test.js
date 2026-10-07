"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const jid = (phone) => `${phone}@s.whatsapp.net`;
const NOON = Date.parse("2026-10-08T09:00:00Z"); // 12:00 in Cairo
const MIN = 60 * 1000;

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `C${++n}`, remoteJid: from, fromMe: false }, pushName: "Client", message: { conversation: text } });
  const last = () => sock.sent.at(-1);
  return { app, sock, send, last, text: () => last().content.text || last().content.caption || "" };
}

/** Listing #1 and seven clients: three it should reach, four it shouldn't. */
function setup(s) {
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6, size: 150 }, ME);
  const wants = { type: "شقة", deal: "بيع", location: "التجمع", max: 3.5e6 };
  const a = leads.add(s, { name: "أحمد", phone: "201001110001", ...wants }, ME); // #1
  const b = leads.add(s, { name: "منى", phone: "201001110002", ...wants }, ME); // #2
  const c = leads.add(s, { name: "سارة", phone: "201001110003", ...wants }, ME); // #3
  const out = leads.add(s, { name: "خالد", phone: "201001110004", ...wants }, ME); // #4 opted out
  leads.setOptOut(s, out.id, true);
  leads.add(s, { name: "بدون رقم", ...wants }, ME); // #5 no phone
  const had = leads.add(s, { name: "هدى", phone: "201001110006", ...wants }, ME); // #6 already got it
  leads.markSent(s, had.id, 1, ME, "أُرسل له العقار #1");
  leads.add(s, { name: "زايد", phone: "201001110007", type: "فيلا", location: "زايد" }, ME); // #7 wants something else
  return { a, b, c };
}

test("preview lists only the clients a campaign would reach; 'go' starts it; clients can't", async () => {
  const b = bot();
  setup(b.app.state);
  await b.send(".blast 1");
  const r = b.text();
  assert.match(r, /📣 \*Campaign preview — #1\*/);
  assert.match(r, /Goes to 3 client\(s\):\n▫️ #\d+ (أحمد|منى|سارة) \(\+20100111000[123]\)/);
  assert.doesNotMatch(r, /خالد|بدون رقم|هدى|زايد/);
  assert.match(r, /One message every 45–90 s, 10:00–21:00, at most 40 a day: about 4 min\./);
  assert.match(r, /لإيقاف رسائل العروض أرسل: وقف/);
  assert.equal(campaigns.all(b.app.state).length, 0, "the preview starts nothing");

  await b.send(".blast 1 go");
  assert.match(b.text(), /▶️ Campaign #1 started: #1 to 3 client\(s\)/);
  await b.send(".blast 1 go");
  assert.match(b.text(), /A campaign for #1 is already running/);
  await b.send(".blast 1", jid("201001110001"));
  assert.doesNotMatch(b.text(), /Campaign preview/, "owner and sudo only");
});

test("sending: one message per gap, only in the day, opt-outs skipped, a summary at the end", async () => {
  const b = bot();
  const s = b.app.state;
  const { a, b: mona, c } = setup(s);
  await b.send(".blast 1 go");
  const before = b.sock.sent.length;

  assert.equal(await campaigns.tick(b.app, NOON - 3 * 60 * MIN, () => 0), "hours", "not before 10:00");
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "sent");
  const first = b.sock.sent.at(-1);
  assert.ok([a, mona, c].some((l) => first.jid === jid(l.phone)));
  assert.match(first.content.text, /^أهلاً (أحمد|منى|سارة) 👋\nعندي عقار مناسب لطلبك:\n\n🏠 \*شقة للبيع\* — #1/);
  assert.match(first.content.text, /للاستفسار رد على الرسالة أو أرسل: #1\nلإيقاف رسائل العروض أرسل: وقف$/);

  assert.equal(await campaigns.tick(b.app, NOON + 30 * 1000, () => 0), "gap", "45 s at least between messages");
  assert.equal(await campaigns.tick(b.app, NOON + 45 * 1000, () => 0), "sent");
  assert.equal(b.sock.sent.length, before + 2);

  // The third client says stop before their turn.
  const third = campaigns.get(s, 1).queue[0];
  const phone = leads.get(s, third).phone;
  await b.send("وقف", jid(phone));
  assert.equal(b.last().jid, jid(phone));
  assert.match(b.text(), /✅ تم إيقاف رسائل العروض/);
  assert.equal(leads.get(s, third).optedOut, true);
  assert.equal(await campaigns.tick(b.app, NOON + 2 * MIN, () => 0), "done");
  assert.equal(b.last().jid, ME, "the summary goes to the chat that started it");
  assert.match(b.text(), /📣 حملة #1 للعقار #1: ✅ 2 أُرسلت · ⏭️ 1 تخطي من 3/);
  assert.equal(campaigns.get(s, 1).status, "done");

  const sent = leads.all(s).filter((l) => (l.sentListings || []).includes(1) && l.id !== 6);
  assert.equal(sent.length, 2);
  for (const l of sent) {
    assert.equal(l.status, "contacted");
    assert.match(l.history.at(-1).text, /أُرسل له العقار #1 \(حملة #1\)/);
  }
  assert.equal(re.get(s, 1).stats.sent, 3, "2 by the campaign + 1 earlier");
  await b.send(".blast 1");
  assert.match(b.text(), /No client to send #1 to/, "nobody gets the same listing twice");
});

test("the daily cap, a sold listing stopping the campaign, .blast stop and .campaigns", async () => {
  const b = bot();
  const s = b.app.state;
  setup(s);
  await b.send(".blast limit 1");
  assert.match(b.text(), /At most 1 campaign messages a day/);
  await b.send(".blast hours 9:00-18:00");
  assert.match(b.text(), /between 09:00 and 18:00/);
  await b.send(".blast hours 18:00-9:00");
  assert.match(b.text(), /start before end/);
  await b.send(".blast 1 go");
  assert.equal(await campaigns.tick(b.app, NOON, () => 1), "sent");
  assert.equal(await campaigns.tick(b.app, NOON + 10 * MIN, () => 1), "cap");
  const tomorrow = NOON + 24 * 60 * MIN;
  re.update(s, 1, { status: "sold" });
  assert.equal(await campaigns.tick(b.app, tomorrow), "done");
  assert.match(b.text(), /⏹️ أُوقفت: العقار #1 لم يعد متاحاً/);
  assert.equal(campaigns.get(s, 1).status, "stopped");

  re.update(s, 1, { status: "available" });
  await b.send(".blast 1 go");
  await b.send(".campaigns");
  assert.match(b.text(), /▶️ جارية 📣 حملة #2 للعقار #1: ✅ 0 أُرسلت من 2 · ⏳ 2 متبقي/);
  assert.match(b.text(), /⏹️ موقوفة 📣 حملة #1/);
  await b.send(".blast stop 2");
  assert.match(b.text(), /Stopped; nothing more will be sent/);
  assert.equal(await campaigns.tick(b.app, tomorrow + MIN), "idle");
  await b.send(".blast stop 2");
  assert.match(b.text(), /already stopped/);
});

test("opt-out and back in; strangers and repeats get no reply; .lead send respects it", async () => {
  const b = bot();
  const s = b.app.state;
  const { a } = setup(s);
  const count = () => b.sock.sent.length;

  let n = count();
  await b.send("وقف", jid("201009999999")); // not a client
  assert.equal(count(), n, "unknown numbers are ignored");

  s.setPublic(false); // a stop request is honoured even when the bot only answers its owner
  await b.send("stop", jid(a.phone));
  assert.match(b.text(), /تم إيقاف رسائل العروض/);
  s.setPublic(true);
  n = count();
  await b.send("وقف", jid(a.phone));
  assert.equal(count(), n, "already stopped: no reply");
  await b.send(`.lead send ${a.id} 1`);
  assert.match(b.text(), /asked not to receive offers/);
  await b.send(`.lead ${a.id}`);
  assert.match(b.text(), /🚫 أوقف رسائل العروض/);

  await b.send("اشتراك", jid(a.phone));
  assert.match(b.text(), /تم تفعيل رسائل العروض مرة أخرى/);
  assert.equal(leads.get(s, a.id).optedOut, undefined);
  assert.match(leads.get(s, a.id).history.at(-1).text, /طلب استقبال العروض مرة أخرى/);
  await b.send(`.lead send ${a.id} 1`);
  assert.match(b.text(), /📤 Listing #1 sent/);
  assert.ok(leads.get(s, a.id).sentListings.includes(1));
});
