"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const digest = require("../src/services/digest");
const campaigns = require("../src/services/campaigns");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const jid = (phone) => `${phone}@s.whatsapp.net`;
const T0 = Date.parse("2026-10-08T07:00:00Z"); // 10:00 in Cairo
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `A${++n}`, remoteJid: from, fromMe: false }, pushName: "Mona", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 2.8e6, rooms: 3 }, ME); // #1
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.5e6, rooms: 3 }, ME); // #2
  return { app, sock, send, s, text: () => sock.sent.at(-1).content.text || "" };
}

test("a client's first message after a listing was sent is noted as a reply; later ones only update 'last message'", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  const b = bot();
  const mona = leads.add(b.s, { name: "منى", phone: "201002223333" }, ME);
  await b.send(`.lead send ${mona.id} 1`);
  await b.send(`.lead ${mona.id}`);
  assert.match(b.text(), /📤 آخر إرسال: #1 — .* \(لم يرد بعد\)/);
  assert.doesNotMatch(b.text(), /💬 آخر رسالة/);

  t.mock.timers.setTime(T0 + 60 * MIN);
  await b.send("وقف", jid(mona.phone));
  assert.equal(leads.get(b.s, mona.id).replied, undefined, "a stop request isn't a reply");
  await b.send("اشتراك", jid(mona.phone));
  await b.send("تمام، ممكن صور أكتر؟", jid(mona.phone));
  let l = leads.get(b.s, mona.id);
  assert.equal(l.replied, true);
  assert.equal(l.lastMsgAt, T0 + 60 * MIN);
  assert.equal(l.history.at(-1).text, "ردّ بعد إرسال العقار #1");
  const notes = l.history.length;

  t.mock.timers.setTime(T0 + 65 * MIN);
  await b.send("وبكام المتر؟", jid(mona.phone));
  l = leads.get(b.s, mona.id);
  assert.equal(l.lastMsgAt, T0 + 60 * MIN, "within 10 minutes: nothing written");
  t.mock.timers.setTime(T0 + 80 * MIN);
  await b.send("شكراً", jid(mona.phone));
  l = leads.get(b.s, mona.id);
  assert.equal(l.lastMsgAt, T0 + 80 * MIN);
  assert.equal(l.history.length, notes, "only the first reply is noted");
  await b.send(`.lead ${mona.id}`);
  assert.match(b.text(), /📤 آخر إرسال: #1 — [^\n(]*\n💬 آخر رسالة منه:/, "no longer 'awaiting reply'");

  const before = leads.all(b.s).map((x) => x.lastMsgAt);
  await b.send("مرحبا", jid("201009999999")); // not a client
  await b.send("مرحبا"); // the owner
  assert.deepEqual(leads.all(b.s).map((x) => x.lastMsgAt), before);

  b.s.setPublic(false);
  t.mock.timers.setTime(T0 + 2 * DAY);
  await b.send("لسه متاحة؟", jid(mona.phone));
  assert.equal(leads.get(b.s, mona.id).lastMsgAt, T0 + 2 * DAY, "noted in private mode too (nothing is answered)");
  t.mock.timers.reset();
});

test("morning summary: who replied in the last day and who went quiet after a listing; .restats reply rate", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 - 20 * DAY });
  const b = bot();
  const s = b.s;
  const old = leads.add(s, { name: "قديم", phone: "201000000001" }, ME);
  leads.markSent(s, old.id, 2, ME, "أُرسل له العقار #2"); // 20 days ago, never answered: not nagged any more
  t.mock.timers.setTime(T0 - 3 * DAY);
  const quiet = leads.add(s, { name: "سارة", phone: "201000000002" }, ME);
  leads.markSent(s, quiet.id, 1, ME, "أُرسل له العقار #1"); // 3 days, no answer
  const fresh = leads.add(s, { name: "أحمد", phone: "201000000003" }, ME);
  leads.markSent(s, fresh.id, 1, ME, "أُرسل له العقار #1");
  t.mock.timers.setTime(T0 - 2 * 60 * MIN);
  await b.send("مهتم، نحدد معاينة؟", jid(fresh.phone)); // answered 2 hours ago
  t.mock.timers.setTime(T0);
  const yesterday = leads.add(s, { name: "منى", phone: "201000000004" }, ME);
  leads.markSent(s, yesterday.id, 2, ME, "أُرسل له العقار #2"); // today: too early to call it quiet

  const text = digest.build(s, "Africa/Cairo", T0);
  assert.match(text, /💬 \*ردوا على ما أرسلته آخر 24 ساعة \(1\)\*\n.*أحمد.* — بخصوص #1/);
  assert.match(text, /📭 \*أُرسل لهم عقار ولم يردوا \(1\)\*\n.*سارة.* — #1 منذ 3 يوم/);
  assert.doesNotMatch(text, /📭[^💤]*قديم/u, "after 14 days it's left to the 'no contact' list");
  assert.doesNotMatch(text, /📭[^💤]*منى/u);

  await b.send(".restats");
  assert.match(b.text(), /📬 نسبة الرد: 1 من 4 عميل أرسلت لهم عقاراً ردّوا \(25%\)/);
  t.mock.timers.reset();
});

test("listings answered automatically to a request count as sent: campaigns skip them, the next message is a reply", async () => {
  const b = bot();
  await b.send(".agent requests on");
  const client = jid("201099998888");
  await b.send("عايز شقة في التجمع 3 غرف ميزانية 3 مليون", client);
  const [lead] = leads.all(b.s);
  assert.deepEqual(lead.sentListings.sort(), [1, 2]);
  assert.equal(lead.status, "contacted");
  assert.match(lead.history.at(-1).text, /^أُرسل له تلقائياً: #2، #1$/);
  assert.equal(re.get(b.s, 1).stats.sent, 1);
  assert.equal(leads.awaitingReply(lead), true);
  assert.deepEqual(campaigns.targets(b.s, re.get(b.s, 1)), [], "a campaign for #1 won't send it again");
  await b.send("#2", client);
  assert.equal(leads.get(b.s, lead.id).replied, true);
});
