"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const { groupData } = require("../src/services/settings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net"; // the owner
const AHMED = "201033334444@s.whatsapp.net"; // sudo
const MONA = "201055556666@s.whatsapp.net"; // sudo
const STRANGER = "201077770000@s.whatsapp.net";
const c = (n) => `20109999000${n}@s.whatsapp.net`; // clients

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((x) => [x, { ...x, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, x]) => [k, copies.get(x)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  groupData(app.state).update((d) => (d.sudo = [AHMED, MONA]));
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, { from = ME, mentions } = {}) =>
    d.handleMessage(sock, {
      key: { id: `T${++n}`, remoteJid: from, fromMe: false },
      pushName: "عميل",
      message: mentions ? { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } } : { conversation: text },
    });
  re.add(app.state, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); // #1
  return { app, sock, send, s: app.state, last: (jid) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "", to: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test(".team autoassign: new clients who arrive by themselves go to the members in turn, with their notices; hand-added clients aren't touched", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T12:00:00+03:00") });
  const b = bot();
  await b.send(".team autoassign");
  assert.match(b.last(ME), /^🔄 Handing new clients out in turn is off/);
  await b.send(".team autoassign @x", { mentions: [STRANGER] });
  assert.match(b.last(ME), /Only the owner and sudo users can take clients/);
  await b.send(".team autoassign @a @m", { mentions: [AHMED, MONA] });
  assert.match(b.last(ME), /^🔄 New clients now go in turn to: @201033334444 → @201055556666/);

  re.setAgent(b.s, "autoleads", "on");
  re.setAgent(b.s, "requests", "on");
  re.setAgent(b.s, "booking", "on");

  await b.send("#1", { from: c(1) }); // a #12 question
  const one = leads.byPhone(b.s, "201099990001");
  assert.equal(one.assignee, AHMED);
  assert.match(b.last(AHMED), /^🔔 عميل جديد: عميل \(\+201099990001\) سأل عن #1/, "the notice goes to the member");
  assert.equal(b.to(ME).filter((m) => /سأل عن #1/.test(m.content.text || "")).length, 0, "not to the owner");

  await b.send("عايز شقة في التجمع ميزانية 3.5 مليون", { from: c(2) }); // a written request
  const two = leads.byPhone(b.s, "201099990002");
  assert.equal(two.assignee, MONA, "the next one");
  assert.match(b.last(MONA), /^🔔 طلب من عميل جديد/);

  await b.send("معاينة 1", { from: c(3) }); // a self-booked viewing
  await b.send("1", { from: c(3) });
  const three = leads.byPhone(b.s, "201099990003");
  assert.equal(three.assignee, AHMED, "round again");
  assert.match(b.last(AHMED), /^📅 \*حجز معاينة من العميل\* \(عميل جديد\)/);
  assert.equal(viewings.upcoming(b.s).find((v) => v.lead === three.id).chat, AHMED, "the viewing reminder goes to the member too");

  await b.send("#1", { from: c(1) }); // the same client again
  assert.equal(leads.byPhone(b.s, "201099990001").assignee, AHMED, "an assigned client keeps the member");
  await b.send(".lead add\nالاسم: يدوي\nالموبايل: 01099990009");
  assert.equal(leads.byPhone(b.s, "201099990009").assignee, undefined, "clients added by hand aren't touched");
  assert.match(leads.get(b.s, one.id).history.map((h) => h.text).join("\n"), /أُسند تلقائياً إلى @201033334444/);

  await b.send(".team autoassign");
  assert.match(b.last(ME), /Next: @201055556666/);
  await b.send(".autopilot");
  assert.match(b.last(ME), /✅ توزيع العملاء الجدد على الفريق بالدور \(2 أعضاء\)/);
  await b.send(".team autoassign off");
  await b.send("#1", { from: c(4) });
  assert.equal(leads.byPhone(b.s, "201099990004").assignee, undefined, "off: nobody's turn");
  assert.match(b.last(ME), /^🔔 عميل جديد: عميل \(\+201099990004\)/, "back to the owner");
  t.mock.timers.reset();
});

test("the customer assistant's new clients go in turn too, and the member is told", async () => {
  const b = bot();
  b.app.ai = { label: "Test AI", ask: async () => "أهلاً بيك 👋 عندي #1 في التجمع" };
  re.setAgent(b.s, "assistant", "on");
  await b.send(".team autoassign me @m", { mentions: [MONA] });
  assert.match(b.last(ME), /@201011112222 → @201055556666/, "'me' takes a turn too");
  await b.send("عندك شقق في التجمع؟", { from: c(5) });
  assert.equal(leads.byPhone(b.s, "201099990005").assignee, ME);
  assert.match(b.last(ME), /^🧑‍💼 عميل جديد ليك: عميل \(\+201099990005\) — المساعد بيرد عليه/);
  await b.send("عندك فيلا؟", { from: c(6) });
  assert.equal(leads.byPhone(b.s, "201099990006").assignee, MONA);
  assert.match(b.last(MONA), /^🧑‍💼 عميل جديد ليك/);
});
