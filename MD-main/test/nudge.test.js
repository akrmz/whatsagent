"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const campaigns = require("../src/services/campaigns");
const digest = require("../src/services/digest");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);
const jid = (p) => `${p}@s.whatsapp.net`;

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `N${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  re.setAgent(app.state, "name", "أحمد");
  return { app, sock, send, s: app.state, sentTo: (p) => sock.sent.filter((m) => m.jid === jid(p)), text: () => sock.sent.at(-1).content.text || "" };
}

/** Clients sent something at different times: who is due for a follow-up on 2026-10-09? */
function setup(b, t) {
  const s = b.s;
  const sendAt = (lead, when) => {
    t.mock.timers.setTime(when);
    leads.markSent(s, lead.id, 1, ME, "أُرسل له العقار #1", when);
  };
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME);
  const wants = { type: "شقة", location: "التجمع", max: 3.5e6 };
  const mona = leads.add(s, { name: "منى", phone: "201000000001", ...wants }, ME);
  sendAt(mona, at("2026-10-04", "12:00")); // 5 days, no reply: due
  const sara = leads.add(s, { name: "سارة", phone: "201000000002", ...wants }, ME);
  sendAt(sara, at("2026-10-08", "12:00")); // 1 day: too early
  const old = leads.add(s, { name: "قديم", phone: "201000000003", ...wants }, ME);
  sendAt(old, at("2026-09-20", "12:00")); // 19 days: left to the agent
  const replied = leads.add(s, { name: "رد", phone: "201000000004", ...wants }, ME);
  sendAt(replied, at("2026-10-04", "12:00"));
  leads.seen(s, replied.id, at("2026-10-05", "12:00")); // answered
  const won = leads.add(s, { name: "اشترى", phone: "201000000005", ...wants }, ME);
  sendAt(won, at("2026-10-04", "12:00"));
  leads.update(s, won.id, { status: "won" });
  const out = leads.add(s, { name: "أوقف", phone: "201000000006", ...wants }, ME);
  sendAt(out, at("2026-10-04", "12:00"));
  leads.setOptOut(s, out.id, true);
  return { mona };
}

test("who gets a follow-up: active, no reply 3–14 days after a send, not followed up for it yet", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-01", "09:00") });
  const b = bot();
  setup(b, t);
  assert.deepEqual(campaigns.nudgeTargets(b.s, at("2026-10-09", "10:00")).map((l) => l.name), ["منى"]);
  t.mock.timers.reset();
});

test(".agent nudge on: once a day from the sending hours, one paced message each, once per send; replies tracked", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-01", "09:00") });
  const b = bot();
  const { mona } = setup(b, t);
  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "10:30"), () => 0), "idle", "off by default");
  await b.send(".agent nudge on");
  assert.match(b.text(), /nudge: on/);

  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "09:30"), () => 0), "hours", "not before the sending hours");
  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "10:00"), () => 0), "sent");
  const msg = b.sentTo(mona.phone).at(-1).content.text;
  assert.match(msg, /^أهلاً منى 👋\nلسه بتدور على شقة، في التجمع، حتى 3\.5 مليون جنيه؟ لو حابب أبعتلك اختيارات جديدة، قولي الميزانية والمنطقة اللي تناسبك 🙏\nأحمد/);
  assert.match(msg, /🏠 عندي حالياً: \*#1\*/);
  assert.match(msg, /لإيقاف رسائل العروض أرسل: وقف$/);
  assert.match(b.sentTo("201011112222").at(-1).content.text, /📣 متابعة #1 للعملاء اللي ما ردوش: ✅ 1 أُرسلت من 1/);
  const l = leads.get(b.s, mona.id);
  assert.match(l.history.at(-1).text, /أُرسلت له رسالة متابعة/);
  assert.match(digest.build(b.s, "Africa/Cairo", at("2026-10-10", "08:30")), /منى.* · 🔔 تمت متابعته/);

  // The next day: already followed up for that send, so nothing new.
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "11:00"), () => 0), "idle");
  assert.equal(campaigns.all(b.s).length, 1);
  // She answers the follow-up: a reply, counted as usual.
  await b.send("أيوه لسه بدور", jid(mona.phone));
  assert.equal(leads.get(b.s, mona.id).replied, true);
  t.mock.timers.reset();
});

test("own wording with .agent nudgetext; someone who replies before their turn is skipped", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-01", "09:00") });
  const b = bot();
  const { mona } = setup(b, t);
  await b.send(".agent nudge on");
  await b.send(".agent nudgetext {name}، لسه مهتم؟ عندي جديد في المنطقة اللي بتدور فيها");
  assert.match(campaigns.nudgeText(b.s, mona), /^منى، لسه مهتم؟ عندي جديد في المنطقة اللي بتدور فيها/);

  campaigns.planNudges(b.app, at("2026-10-09", "10:00"));
  leads.seen(b.s, mona.id, at("2026-10-09", "10:01")); // she writes before her turn
  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "10:02"), () => 0), "done");
  assert.equal(b.sentTo(mona.phone).length, 0);
  t.mock.timers.reset();
});
