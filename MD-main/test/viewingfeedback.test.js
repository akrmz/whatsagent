"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const feedback = require("../src/services/viewingfeedback");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const MONA = "201099998888@s.whatsapp.net";
const ALI = "201077776666@s.whatsapp.net";
const AT = Date.parse("2026-10-11T13:00:00+03:00"); // the viewing
const H = 3600 * 1000;

function bot(t) {
  t.mock.timers.enable({ apis: ["Date"], now: AT - 24 * H });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `F${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6 }, ME); // #1
  const mona = leads.add(s, { name: "منى", phone: "201099998888", status: "viewing" }, ME);
  const ali = leads.add(s, { name: "علي", phone: "201077776666" }, ME);
  const v1 = viewings.add(s, { lead: mona.id, listing: 1, at: AT, chat: ME, by: ME });
  const v2 = viewings.add(s, { lead: ali.id, listing: 1, at: AT + 30 * 60 * 1000, chat: ME, by: ME });
  const texts = (jid) => sock.sent.filter((m) => m.jid === jid).map((m) => m.content.text || "");
  const at = (ms) => t.mock.timers.setTime(ms);
  return { app, s, send, texts, at, mona, ali, v1, v2, last: (jid) => texts(jid).at(-1) || "" };
}

test("on: 3 hours after a viewing the client is asked once; a clear answer becomes the outcome", async (t) => {
  const b = bot(t);
  b.at(AT + 4 * H);
  assert.equal(await feedback.askDue(b.app, AT + 4 * H), 0, "off by default");
  await b.send(".agent feedback on");
  b.at(AT + 2 * H);
  assert.equal(await feedback.askDue(b.app, AT + 2 * H), 0, "not before 3 hours");
  b.at(AT + 3.6 * H);
  assert.equal(await feedback.askDue(b.app, AT + 3.6 * H), 2);
  assert.equal(b.last(MONA), "أهلاً منى 👋\nإيه رأيك في شاليه في الساحل الشمالي اللي عاينتها؟\nرد بكلمة: *عجبتني* · *هفكر* · *مش مناسبة*، أو اكتبلي رأيك 🙏");
  assert.equal(await feedback.askDue(b.app, AT + 4 * H), 0, "once");

  await b.send("عجبتني جداً بس عايز أعرف المقدم", MONA);
  assert.equal(b.last(MONA), "تمام 🙏 مبسوط إنها عجبتك. هكلمك قريب نكمّل الخطوات.");
  const v = viewings.get(b.s, b.v1.id);
  assert.deepEqual([v.outcome.result, v.outcome.note, v.outcome.by], ["liked", "عجبتني جداً بس عايز أعرف المقدم", "client"]);
  assert.equal(leads.get(b.s, b.mona.id).status, "negotiating", "as .viewing done liked does");
  assert.match(b.last(ME), /^🗣️ منى \(\+201099998888\) عن معاينة #1: 👍 أعجبه — "عجبتني جداً بس عايز أعرف المقدم"\n🤝 اتنقل للتفاوض/);
  const n = b.texts(ME).length;
  await b.send("وكمان عندي سؤال", MONA);
  assert.equal(b.texts(ME).length, n, "one answer is taken");

  // Not a clear answer: passed to the agent as it is.
  await b.send("امتى أقدر أشوفها تاني؟", ALI);
  assert.match(b.last(ME), /^💬 علي \(\+201077776666\) رد عن معاينة #1:\n"امتى أقدر أشوفها تاني؟"\n\.viewing done 2 liked \| thinking \| no/);
  assert.equal(viewings.get(b.s, b.v2.id).outcome, undefined);
  t.mock.timers.reset();
});

test("no question when the outcome is already recorded, nor to a client who said وقف", async (t) => {
  const b = bot(t);
  await b.send(".agent feedback on");
  b.at(AT + 2.5 * H);
  await b.send(`.viewing done ${b.v1.id} no صغيرة`);
  leads.setOptOut(b.s, b.ali.id, true);
  b.at(AT + 4 * H);
  assert.equal(await feedback.askDue(b.app, AT + 4 * H), 0);
  assert.equal(b.texts(MONA).length + b.texts(ALI).length, 0);
  t.mock.timers.reset();
});

test("reading the answer: negatives first, unclear left to the agent", () => {
  const cases = { "عجبتني": "liked", "مش حلوة خالص": "no", "هفكر وأرد عليك": "thinking", "غالية شوية": "no", "👍": "liked", "لا": "no", "تمام": null, "امتى أقدر أشوفها؟": null, "مش مناسبة للأسف": "no" };
  for (const [text, want] of Object.entries(cases)) assert.equal(feedback.classify(text), want, text);
  assert.equal(feedback.classify("حلوة ".repeat(100)), null, "a long text isn't read as an answer");
});
