"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const requests = require("../src/services/requests");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = CLIENT, chat } = {}) =>
    d.handleMessage(sock, { key: { id: `R${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "Mona", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 2.8e6, size: 140, rooms: 3 }, ME); // #1
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3.3e6, size: 160, rooms: 3 }, ME); // #2 a little over
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.5e6, size: 120, rooms: 3 }, ME); // #3
  const sold = re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 2.6e6, rooms: 3 }, ME); // #4 sold
  re.update(s, sold.id, { status: "sold" });
  re.add(s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", price: 9e6 }, ME); // #5
  return { app, sock, send, s, sentTo: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test("what counts as a request: a property type and a word of asking, not a broker's post", () => {
  assert.deepEqual(requests.detect("عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون"), { type: "شقة", location: "التجمع", rooms: 3, min: 2e6, max: 3e6 });
  assert.deepEqual(requests.detect("عندك فيلا في الشيخ زايد؟"), { type: "فيلا", location: "الشيخ زايد" });
  assert.deepEqual(requests.detect("محتاج شقة إيجار في المعادي حدود 15 ألف"), { type: "شقة", deal: "إيجار", location: "المعادي", max: 15000 });
  assert.equal(requests.detect("يوجد شقة للبيع في التجمع 150 متر بسعر 3 مليون"), null, "a broker's post");
  assert.equal(requests.detect("متاح شقة للبيع بالتجمع 120 متر"), null);
  assert.equal(requests.detect("عايز اعرف السعر"), null, "no property type");
  assert.equal(requests.detect("السلام عليكم"), null);
  assert.equal(requests.detect(`عايز شقة ${"تفاصيل ".repeat(60)}`), null, "too long to be a quick request");
  assert.equal(requests.describe({ type: "شقة", deal: "بيع", location: "التجمع", rooms: 3, max: 3e6 }, "جنيه"), "شقة للبيع، في التجمع، 3 غرف، حتى 3 مليون جنيه");
});

test("off by default; on: the client gets the closest listings, is saved, and the owner is told", async () => {
  const b = bot();
  const ask = "عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون";
  await b.send(ask);
  assert.equal(b.sentTo(CLIENT).length, 0, "nothing until .agent requests on");
  assert.equal(leads.all(b.s).length, 0);

  await b.send(".agent requests on", { from: ME });
  assert.match(b.sock.sent.at(-1).content.text, /requests: on/);
  await b.send(ask);
  const reply = b.sentTo(CLIENT).at(-1).content.text;
  assert.match(reply, /^أهلاً Mona 👋\nدي أقرب العقارات المتاحة لطلبك \(شقة، في التجمع، 3 غرف، 2 مليون – 3 مليون جنيه\):\n\n/);
  const ids = [...reply.matchAll(/\*#(\d+)\*/g)].map((m) => Number(m[1]));
  assert.deepEqual(ids, [3, 1, 2], "within budget first (cheaper first), then a little over; sold and other types left out");
  assert.match(reply, /أرسل رقم العقار \(مثلاً #3\) للتفاصيل والصور\.$/);

  const [lead] = leads.all(b.s);
  assert.equal(lead.name, "Mona");
  assert.equal(lead.phone, "201099998888");
  assert.equal(lead.source, "واتساب");
  assert.equal(lead.max, 3e6);
  assert.match(lead.history[0].text, /^طلب: عايز شقة في التجمع/);
  const note = b.sentTo(ME).at(-1).content.text;
  assert.match(note, /^🔔 طلب من عميل جديد: Mona \(\+201099998888\)\n🔎 شقة، في التجمع، 3 غرف، 2 مليون – 3 مليون جنيه\nأرسلت له 3: #3، #1، #2\n\.lead 1$/);
});

test("limits: one answer per client per 10 minutes (silent, no greeting either); existing clients are updated", async () => {
  const b = bot();
  await b.send(".agent requests on", { from: ME });
  await b.send(".greet on", { from: ME });
  const existing = leads.add(b.s, { name: "منى", phone: "201099998888", type: "فيلا", location: "زايد", max: 10e6 }, ME);
  await b.send("عندك فيلا في الشيخ زايد؟");
  assert.match(b.sentTo(CLIENT).at(-1).content.text, /^أهلاً منى 👋\nدي أقرب العقارات المتاحة لطلبك \(فيلا، في الشيخ زايد\)/);
  assert.match(b.sentTo(ME).at(-1).content.text, /^🔔 طلب جديد: منى/);
  const lead = leads.get(b.s, existing.id);
  assert.equal(lead.location, "الشيخ زايد", "the new request updates the wishes it mentions");
  assert.equal(lead.max, 10e6, "and keeps the rest");
  assert.equal(leads.all(b.s).length, 1, "no duplicate client");

  const count = b.sentTo(CLIENT).length;
  await b.send("طب عايز شقة في التجمع؟");
  assert.equal(b.sentTo(CLIENT).length, count, "a second request within 10 minutes gets no reply (and no greeting)");
});

test("no match, broker posts, groups, staff and private mode", async () => {
  const b = bot();
  await b.send(".agent requests on", { from: ME });
  await b.send("محتاج شقة إيجار في المعادي حدود 15 ألف");
  assert.match(b.sentTo(CLIENT).at(-1).content.text, /وصلني طلبك \(شقة للإيجار، في المعادي، حتى 15 ألف جنيه\) 👍\nحالياً مفيش عقار مطابق، وهتواصل معاك أول ما يتوفر\./);
  assert.match(b.sentTo(ME).at(-1).content.text, /لا يوجد عقار مطابق/);

  const other = "201055554444@s.whatsapp.net";
  await b.send("يوجد شقة للبيع في التجمع 150 متر بسعر 3 مليون", { from: other });
  assert.equal(b.sentTo(other).length, 0, "a broker's post isn't a request");
  await b.send("عايز شقة في التجمع؟", { from: other, chat: GROUP });
  assert.equal(b.sentTo(GROUP).length, 0, "groups are ignored");
  const before = leads.all(b.s).length;
  await b.send("عايز شقة في التجمع؟", { from: ME });
  assert.equal(leads.all(b.s).length, before, "the owner isn't a client");
  b.s.setPublic(false);
  await b.send("عايز شقة في التجمع؟", { from: other });
  assert.equal(b.sentTo(other).length, 0, "in private mode the bot doesn't answer strangers");
});
