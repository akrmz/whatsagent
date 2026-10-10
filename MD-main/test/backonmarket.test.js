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
  const send = (text) => d.handleMessage(sock, { key: { id: `B${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6 }, ME); // #1
  const client = (name, phone, note, extra = {}) => {
    const l = leads.add(s, { name, phone, type: "شاليه", deal: "بيع", ...extra }, ME);
    if (note) leads.note(s, l.id, ME, note);
    return l;
  };
  const people = {
    asked: client("منى", "201001110001", "سأل عن العقار #1 (شاليه — الساحل الشمالي — ⏳ محجوز)"),
    liked: client("أحمد", "201001110002", "نتيجة معاينة #1: 👍 عجبه"),
    sentOnly: client("سارة", "201001110003", "أُرسل له العقار #1 (حملة #1)"),
    disliked: client("هاني", "201001110004", "نتيجة معاينة #1: 👎 صغير"),
    won: client("كريم", "201001110005", "سأل عن العقار #1 (شاليه)"),
    other: client("رنا", "201001110006", "سأل عن العقار #2 (شقة)"),
  };
  leads.update(s, people.won.id, { status: "won" });
  return { app, sock, send, s, people, text: () => sock.sent.at(-1).content.text || "", sentTo: (j) => sock.sent.filter((m) => m.jid === j) };
}

test("a unit that comes back on the market: the interested clients are counted, previewed and told once", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON - 60 * MIN });
  const b = bot();
  await b.send(".blast 1 back");
  assert.match(b.text(), /#1 hasn't come back on the market in the last 30 days/, "available all along");

  await b.send(".listing status 1 reserved");
  assert.equal(b.text(), "🔖 #1: ⏳ محجوز");
  assert.equal(re.backOnMarket(re.get(b.s, 1)), null);
  await b.send(".listing status 1 available");
  assert.match(b.text(), /^🔖 #1: ✅ متاح\n\n🔁 2 client\(s\) asked about it, booked a viewing or liked it\. Tell them it's available again: \.blast 1 back$/);
  assert.equal(re.get(b.s, 1).back.from, "reserved");

  await b.send(".blast 1 back");
  const r = b.text();
  assert.match(r, /^🔁 \*Back on the market — #1\*: ⏳ محجوز → ✅ متاح \(النهارده\)/);
  assert.match(r, /Goes to 2 client\(s\) who were interested:/);
  assert.match(r, /▫️ #2 أحمد \(\+201001110002\) — 👍 أعجبه في المعاينة\n▫️ #1 منى \(\+201001110001\) — 💬 سأل عنه/, "the strongest interest first");
  assert.doesNotMatch(r, /سارة|هاني|كريم|رنا/, "not those only sent it, who disliked it, who closed, or asked about another unit");

  await b.send(".blast 1 back go");
  assert.match(b.text(), /▶️ Back-on-the-market campaign #1 started: #1 to 2 client\(s\)/);
  t.mock.timers.setTime(NOON);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "sent");
  assert.equal(await campaigns.tick(b.app, NOON + 2 * MIN, () => 0), "sent");
  assert.match(b.sentTo(jid("201001110001")).at(-1).content.text, /^أهلاً منى 👋\n🔁 \*خبر حلو!\* العقار اللي كنت مهتم بيه رجع متاح تاني:\n\n🏠 \*شاليه للبيع\* — #1/);
  assert.match(b.text(), /📣 حملة رجوع #1 للعقار #1: ✅ 2 أُرسلت من 2/);
  const mona = leads.get(b.s, b.people.asked.id);
  assert.equal(mona.backNotified[1], re.get(b.s, 1).back.at);
  assert.match(mona.history.at(-1).text, /أُرسل له العقار #1 \(رجع متاح تاني، حملة #1\)/);

  await b.send(".blast 1 back");
  assert.match(b.text(), /or they were all told already/, "once per return");

  // Reserved and back again later: news again. More than 30 days after: too late.
  t.mock.timers.setTime(NOON + 3 * DAY);
  await b.send(".listing status 1 reserved");
  await b.send(".listing status 1 available");
  assert.match(b.text(), /🔁 2 client\(s\)/);
  t.mock.timers.setTime(NOON + 40 * DAY);
  await b.send(".blast 1 back");
  assert.match(b.text(), /hasn't come back on the market in the last 30 days/);
  t.mock.timers.reset();
});

test("a back campaign skips a client who closed since it was queued, and merged clients keep who was told", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOON - 60 * MIN });
  const b = bot();
  re.update(b.s, 1, { status: "sold" });
  re.update(b.s, 1, { status: "available" });
  assert.equal(re.get(b.s, 1).back.from, "sold");
  campaigns.start(b.s, re.get(b.s, 1), { by: ME, chat: ME, mode: "back" });
  leads.update(b.s, b.people.liked.id, { status: "won" });
  t.mock.timers.setTime(NOON);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "skipped", "Ahmed bought meanwhile");
  assert.equal(await campaigns.tick(b.app, NOON + 2 * MIN, () => 0), "sent");
  assert.equal(b.sentTo(jid("201001110002")).length, 0);

  const dup = leads.add(b.s, { name: "منى ٢", phone: "201001119999" }, ME);
  leads.merge(b.s, dup.id, b.people.asked.id);
  assert.ok(leads.get(b.s, dup.id).backNotified?.[1], "a merge keeps that she was told");
  t.mock.timers.reset();
});
