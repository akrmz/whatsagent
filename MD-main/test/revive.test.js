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
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+03:00`);
const jid = (p) => `${p}@s.whatsapp.net`;

function bot(t) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const d = createDispatcher(app);
  let n = 0;
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `V${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.setAgent(s, "name", "أحمد");

  t.mock.timers.setTime(at("2026-08-01"));
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3e6 }, ME); // #1: old
  leads.add(s, { name: "منى", phone: "201000000001", type: "شقة", deal: "بيع", location: "التجمع", max: 3.5e6 }, ME);
  const karim = leads.add(s, { name: "كريم", phone: "201000000002", type: "فيلا", location: "زايد", max: 10e6 }, ME);
  leads.update(s, karim.id, { status: "lost" });
  const sara = leads.add(s, { name: "سارة", phone: "201000000003", type: "شقة", location: "التجمع", max: 4e6 }, ME);
  const ali = leads.add(s, { name: "علي", phone: "201000000004", type: "شقة", location: "التجمع", max: 4e6 }, ME);
  leads.setOptOut(s, ali.id, true);
  const won = leads.add(s, { name: "اشترى", phone: "201000000005", type: "شقة", location: "التجمع", max: 4e6 }, ME);
  leads.update(s, won.id, { status: "won" });

  t.mock.timers.setTime(at("2026-09-20"));
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 3.2e6 }, ME); // #2: new, fits Mona
  re.add(s, { type: "فيلا", deal: "بيع", location: "الشيخ زايد", price: 9e6 }, ME); // #3: new, fits Karim
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 5e6 }, ME); // #4: over budget
  t.mock.timers.setTime(at("2026-09-25"));
  leads.seen(s, sara.id, at("2026-09-25")); // Sara wrote recently: not quiet
  t.mock.timers.setTime(at("2026-10-08"));
  return { app, sock, send, s, last: () => sock.sent.at(-1).content.text || sock.sent.at(-1).content.caption || "", to: (p) => sock.sent.filter((m) => m.jid === jid(p)) };
}

test(".leads revive: quiet or lost clients get a listing that is new since and fits them, paced; then they aren't quiet any more", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-08-01") });
  const b = bot(t);

  assert.deepEqual(campaigns.reviveTargets(b.s).map(({ lead, listing }) => [lead.name, listing.id]), [["منى", 2], ["كريم", 3]], "old listing #1 and over-budget #4 aren't offered; recent, stopped and won clients aren't asked");
  await b.send(".leads revive");
  const preview = b.last();
  assert.match(preview, /^🔁 \*Bring back quiet clients\* \(2\)\n[^\n]*\n\n▫️ #1 منى — quiet 68 d → #2 شقة 3\.2 مليون\n▫️ #2 كريم \(❌ lost\) — quiet 68 d → #3 فيلا 9 مليون/);
  assert.match(preview, /#1 reads:\n┈┈┈┈┈┈┈┈\nأهلاً منى 👋\nمن فترة كنت بتدور على شقة للبيع، في التجمع، حتى 3\.5 مليون جنيه\. نزل عندي جديد ممكن يعجبك:\n\n🏠 [^\n]*#2[^\n]*\nللتفاصيل والصور أرسل: #2\n\nأحمد\n\nلإيقاف رسائل العروض أرسل: وقف\n┈┈┈┈┈┈┈┈/);
  assert.equal(b.to("201000000001").length, 0, "nothing sent before go");

  await b.send(".leads revive go");
  assert.match(b.last(), /^▶️ Bringing back 2 client\(s\)/);
  assert.equal(await campaigns.tick(b.app, at("2026-10-08", "12:01"), () => 0), "sent");
  assert.match(b.to("201000000001").at(-1).content.text, /^أهلاً منى 👋\nمن فترة كنت بتدور على/);
  const mona = leads.byPhone(b.s, "201000000001");
  assert.deepEqual(mona.sentListings, [2], "noted as sent: replies are tracked and it won't be offered again");
  assert.match(mona.history.at(-1).text, /^إعادة تواصل: أُرسل له العقار #2 \(حملة #\d+\)/);

  re.update(b.s, 3, { status: "sold" }); // Karim's villa sells before his turn
  assert.equal(await campaigns.tick(b.app, at("2026-10-08", "12:03"), () => 0), "done");
  assert.equal(b.to("201000000002").length, 0, "no fresh match any more: skipped");
  assert.match(b.last(), /^📣 إعادة تواصل #\d+ مع العملاء القدام: ✅ 1 أُرسلت · ⏭️ 1 تخطي من 2/);

  await b.send(".leads revive");
  assert.match(b.last(), /^Nobody to bring back right now/, "Mona was just contacted; Karim's villa is gone");
  t.mock.timers.reset();
});
