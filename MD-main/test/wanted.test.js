"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const feed = require("../src/services/feed");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const BROKERS = "120363000000000007@g.us";
const NOW = Date.parse("2026-10-11T12:00:00+03:00");
const HOUR = 3600 * 1000;

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, chat = ME) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? ME : undefined, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.setAgent(s, "name", "أحمد");
  re.setAgent(s, "phone", "+20 100 123 4567");
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME);
  const lead = (f) => leads.add(s, { phone: `2010011100${String(++n).padStart(2, "0")}`, ...f }, ME);
  lead({ name: "منى", type: "فيلا", deal: "بيع", location: "الشيخ زايد", max: 12e6, rooms: 4 });
  lead({ name: "علي", type: "فيلا", deal: "بيع", location: "الشيخ زايد", max: 15e6 });
  lead({ name: "سارة", type: "شاليه", deal: "بيع", location: "الساحل الشمالي", features: ["صف أول"], max: 9e6 });
  lead({ name: "هاني", type: "شقة", deal: "بيع", location: "التجمع", max: 3.5e6 }); // has a match
  leads.update(s, lead({ name: "كريم", type: "دوبلكس", deal: "بيع", location: "المعادي" }).id, { status: "lost" });
  return { app, s, sock, send, text: (jid = ME) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || "").at(-1) || "" };
}

test(".wanted: what clients want with nothing matching, grouped, and a post that names no client", async () => {
  const b = bot();
  await b.send(".wanted");
  const r = b.text();
  assert.match(r, /^🔎 \*Wanted by your clients, with nothing matching\* \(2\)\n\n• فيلا للبيع في الشيخ زايد · 4 غرف — حتى 15 مليون جنيه — 👥 2\n• شاليه للبيع في الساحل الشمالي · صف أول — حتى 9 مليون جنيه — 👥 1\n/);
  assert.doesNotMatch(r, /شقة للبيع|دوبلكس/, "not what matches, not lost clients");
  const post = r.split("*The post* (no client is named):\n")[1];
  assert.match(post, /^🔎 \*مطلوب لعملاء جاهزين\*\n\n• فيلا للبيع في الشيخ زايد · 4 غرف — حتى 15 مليون جنيه\n• شاليه/);
  assert.match(post, /👤 أحمد · 📞 \+20 100 123 4567/);
  assert.doesNotMatch(post, /منى|علي|سارة|20100111/, "no client named or numbered");
});

test(".wanted post: to the watched brokers' groups, at most once a day each; or here", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const b = bot();
  await b.send(".wanted post");
  assert.match(b.text(), /^No brokers' groups watched yet/);
  feed.watch(b.s, BROKERS, "سماسرة زايد", ME);
  await b.send(".wanted post");
  assert.match(b.text(BROKERS), /^🔎 \*مطلوب لعملاء جاهزين\*/);
  assert.match(b.text(), /^📤 "مطلوب" posted in 1 group\(s\): سماسرة زايد/);
  await b.send(".wanted post");
  assert.match(b.text(), /already had the post in the last 24 hours/);
  await b.send(".wanted post here", BROKERS);
  assert.match(b.text(BROKERS), /^❌ Already posted in this group in the last 24 hours/);
  t.mock.timers.setTime(NOW + 25 * HOUR);
  const before = b.sock.sent.filter((m) => m.jid === BROKERS).length;
  await b.send(".wanted post here", BROKERS);
  assert.equal(b.sock.sent.filter((m) => m.jid === BROKERS).length, before + 1);
  t.mock.timers.reset();
});

test("B-28: brokers once written into listings' notes by .feed add move to the private source, once", () => {
  const b = bot();
  const id = re.add(b.s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME).id;
  // As saved before 3.69 (written straight to the file: adding it now would already clean it).
  b.s.store("listings", { seq: 0, items: {} }).update((d) => (d.items[id].notes = "فيو مفتوح\nمشاركة مع السمسار Hassan +201055554444 (F7)"));
  const updated = re.get(b.s, id).updated;
  assert.equal(feed.moveBrokerNotes(b.s), 1);
  const l = re.get(b.s, id);
  assert.equal(l.notes, "فيو مفتوح");
  assert.deepEqual([l.source.kind, l.source.name, l.source.phones, l.source.feed], ["feed", "Hassan", ["201055554444"], 7]);
  assert.equal(l.updated, updated, "not counted as an update of the listing");
  assert.equal(feed.moveBrokerNotes(b.s), 0, "idempotent");
});
