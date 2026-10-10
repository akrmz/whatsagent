"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const interest = require("../src/services/interest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const KARIM = "201000000002@s.whatsapp.net";
const GROUP = "120363000000000033@g.us";
const DAY = 86400000;

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
    d.handleMessage(sock, { key: { id: `I${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "كريم", message: { conversation: text } });
  return { app, sock, send, s: app.state, last: (jid = ME) => sock.sent.filter((m) => m.jid === jid).at(-1)?.content.text || "" };
}

test(".listing who 12: viewings and their results, questions and sends, the strongest first; closed clients last", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T10:00:00+03:00") });
  const b = bot();
  const s = b.s;
  re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 8e6 }, ME); // #1
  re.add(s, { type: "شاليه", deal: "بيع", location: "العين السخنة", price: 4e6 }, ME); // #2
  const mona = leads.add(s, { name: "منى", phone: "201000000001" }, ME);
  const sara = leads.add(s, { name: "سارة", phone: "201000000003" }, ME);
  const ali = leads.add(s, { name: "علي", phone: "201000000004" }, ME);
  const lost = leads.add(s, { name: "قديم", phone: "201000000005" }, ME);
  leads.markSent(s, sara.id, 1, ME, "أُرسل له العقار #1 (حملة #3)");
  leads.markSent(s, lost.id, [1, 2], ME, "أُرسل له العقار #1");
  leads.update(s, lost.id, { status: "lost" });
  const v1 = viewings.add(s, { lead: mona.id, listing: 1, at: Date.now() + DAY, chat: ME, by: ME });
  const v2 = viewings.add(s, { lead: ali.id, listing: 1, at: Date.now() + DAY, chat: ME, by: ME });
  t.mock.timers.setTime(Date.now() + 2 * DAY);
  await b.send(`.viewing done ${v1.id} liked`);
  await b.send(`.viewing done ${v2.id} noshow`);
  re.setAgent(s, "autoleads", "on");
  await b.send("#1", { from: KARIM }); // Karim asks about it (and is saved as a client)
  const karim = leads.byPhone(s, "201000000002");

  assert.deepEqual(interest.forListing(s, 1).map(({ lead, sign }) => [lead.name, sign.key]), [
    ["منى", "liked"],
    ["كريم", "asked"],
    ["سارة", "sent"],
    ["علي", "noshow"],
    ["قديم", "sent"],
  ]);
  await b.send(".listing who 1");
  const r = b.last();
  assert.match(r, /^👥 \*Who's interested in #1\* — شاليه الساحل الشمالي \(5\)\n\n▫️ \*#1\* منى \(\+201000000001\) — 👍 أعجبه في المعاينة · النهارده · 🤝 تفاوض\n/);
  assert.match(r, new RegExp(`▫️ \\*#${karim.id}\\* كريم \\(\\+201000000002\\) — 💬 سأل عنه · النهارده`));
  assert.match(r, /▫️ \*#4\* قديم \(\+201000000005\) — 📤 اتبعت له · من 2 يوم · ❌ لم يكمل$/m, "closed clients come last");
  assert.match(r, /After a price cut: \.blast 1 drop/);

  await b.send(".listing who 1", { chat: GROUP });
  assert.match(b.sock.sent.at(-1).content.text, /^🔒 The clients for #1 are private/);
  await b.send(".listing who 2");
  assert.match(b.last(), /\(1\)\n\n▫️ \*#4\* قديم/, "a send recorded only in the sent list counts too");
  re.add(s, { type: "فيلا", deal: "بيع", location: "زايد", price: 9e6 }, ME); // #3
  await b.send(".listing who 3");
  assert.match(b.last(), /^Nobody has viewed, asked about or been sent #3 yet/);
  t.mock.timers.reset();
});
