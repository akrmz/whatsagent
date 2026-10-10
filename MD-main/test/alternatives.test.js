"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const leads = require("../src/services/leads");
const re = require("../src/services/realestate");
const { alternatives, offerText } = require("../src/services/alternatives");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000009@g.us";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ME }, { id: CLIENT }] });
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, chat = from, name = "Mona" } = {}) =>
    d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: chat, participant: chat.endsWith("@g.us") ? from : undefined, fromMe: false }, pushName: name, message: { conversation: text } });
  const texts = () => b.sock.sent.map((s) => s.content.text || s.content.caption || "");
  const b = { app, sock, send, texts, last: () => sock.sent.at(-1).content };
  return b;
}

function catalogue(state) {
  const add = ({ status, ...f }) => {
    const id = re.add(state, { deal: "بيع", ...f }, ME).id;
    if (status) re.update(state, id, { status });
    return id;
  };
  return {
    sold: add({ type: "شاليه", location: "الساحل الشمالي - مراسي", price: 9e6, size: 120, rooms: 2 }),
    coastNear: add({ type: "شاليه", location: "الساحل الشمالي - هاسيندا", price: 8.5e6, size: 115, rooms: 2 }),
    coastFar: add({ type: "شاليه", location: "الساحل الشمالي", price: 11e6, size: 140, rooms: 3 }),
    sokhna: add({ type: "شاليه", location: "العين السخنة", price: 9e6, size: 120, rooms: 2 }),
    tooDear: add({ type: "شاليه", location: "الساحل الشمالي", price: 20e6, size: 200 }),
    reserved: add({ type: "شاليه", location: "الساحل الشمالي", price: 9e6, status: "reserved" }),
    villa: add({ type: "فيلا", location: "الساحل الشمالي", price: 9e6 }),
    rent: add({ type: "شاليه", deal: "إيجار", location: "الساحل الشمالي", price: 9e6 }),
  };
}

test("alternatives: the same type and deal, available, the same area first, then the closest price", () => {
  const b = bot();
  const ids = catalogue(b.app.state);
  re.update(b.app.state, ids.sold, { status: "sold" });
  const sold = re.get(b.app.state, ids.sold);
  assert.deepEqual(
    alternatives(b.app.state, sold).map((l) => l.id),
    [ids.coastNear, ids.coastFar, ids.sokhna],
    "the North Coast first (the closer price first), then Sokhna; never the villa, the rental, the reserved one or one 2x the price",
  );
  assert.deepEqual(alternatives(b.app.state, re.get(b.app.state, ids.villa)), [], "nothing like the only villa");
  const text = offerText(sold, alternatives(b.app.state, sold), re.agent(b.app.state));
  assert.match(text, /^🔄 العقار #1 اتباع، بس عندنا بدائل قريبة منه:/);
  assert.match(text, /▫️ \*#2\* شاليه للبيع — الساحل الشمالي - هاسيندا — 8\.5 مليون/);
  assert.match(text, /ابعت رقم العقار للتفاصيل، مثلاً #2$/);
  const en = offerText(sold, alternatives(b.app.state, sold, { max: 1 }), re.agent(b.app.state), { lang: "en" });
  assert.match(en, /^🔄 #1 is sold, but here is a similar one:\n\n▫️ \*#2\* Chalet for sale — North Coast — EGP 8\.5M · 115 m² · 2 beds/);
  assert.match(en, /e\.g\. #2 en$/);
  assert.equal(offerText(sold, [], re.agent(b.app.state)), null);
});

test('a client asking "#1" about a sold chalet gets the card, then up to 3 similar ones, noted for the agent', async () => {
  const b = bot();
  const ids = catalogue(b.app.state);
  re.update(b.app.state, ids.sold, { status: "sold" });
  await b.send(".agent autoleads on");
  const before = b.sock.sent.length;
  await b.send("#1", { from: CLIENT });
  const out = b.texts().slice(before);
  assert.match(out[0], /تم البيع/, "the card says it's sold");
  assert.match(out[1], /^🔄 العقار #1 اتباع/);
  assert.equal((out[1].match(/▫️/g) || []).length, 3);
  const lead = leads.all(b.app.state)[0];
  assert.match(JSON.stringify(lead), /سأل عن العقار #1 \(شاليه — الساحل الشمالي - مراسي — 🔴 تم البيع\)، واتبعتله بدائل: #2، #3، #4/);
  assert.ok(out.some((t) => /🔔 عميل جديد: .*سأل عن #1 — 🔴 تم البيع، واتبعتله بدائل: #2، #3، #4/.test(t)), "the agent knows what was offered");

  // An available unit: just the card, no alternatives.
  const n = b.sock.sent.length;
  await b.send("#2", { from: CLIENT, chat: GROUP });
  assert.equal(b.sock.sent.length, n + 1);
  // A reserved unit in English.
  await b.send("#6 en", { from: CLIENT, chat: GROUP });
  assert.match(b.last().text, /^🔄 #6 is reserved at the moment, but here are similar ones:/);
});

test(".listing similar 12: anyone can see the units like it; the team gets the send command", async () => {
  const b = bot();
  catalogue(b.app.state);
  await b.send(".listing similar 1");
  assert.match(b.last().text, /🔄 \*Similar to #1\*/);
  assert.equal((b.last().text.match(/▫️/g) || []).length, 3, "the reserved one isn't offered");
  assert.match(b.last().text, /\.lead send <client> 2/);
  await b.send(".listing بدائل 1", { from: CLIENT, chat: GROUP });
  assert.match(b.last().text, /للتفاصيل ابعت رقم العقار، مثلاً #2/, "a client gets the #number tip, not a staff command");
  await b.send(".listing similar 7");
  assert.match(b.last().text, /^No available فيلا للبيع close to #7/);
  await b.send(".listing similar 99");
  assert.equal(b.last().text, "There is no listing #99.");
});
