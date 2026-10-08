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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `W${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const s = app.state;
  re.setAgent(s, "name", "أحمد");
  re.setAgent(s, "company", "دار السكن");
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price: 2.8e6, rooms: 3 }, ME); // #1
  const mona = leads.add(s, { name: "منى", phone: "201002223333", source: "إنستجرام", campaign: "شقق التجمع", type: "شقة", location: "التجمع", min: 2e6, max: 3e6 }, ME); // #1
  const sara = leads.add(s, { name: "سارة", phone: "201003334444", source: "فيسبوك" }, ME); // #2
  leads.add(s, { name: "بدون رقم" }, ME); // #3
  const old = leads.add(s, { name: "قديم", phone: "201004445555" }, ME); // #4 already contacted
  leads.update(s, old.id, { status: "contacted" });
  const out = leads.add(s, { name: "أوقف", phone: "201005556666" }, ME); // #5 said stop
  leads.setOptOut(s, out.id, true);
  return { app, sock, send, s, mona, sara, text: () => sock.sent.at(-1).content.text || "", sentTo: (j) => sock.sent.filter((m) => m.jid === j) };
}

test("the welcome: name, the ad, what they want, the agent, the best match, how to stop; own wording", async () => {
  const b = bot();
  assert.equal(
    campaigns.welcomeText(b.s, b.mona),
    "أهلاً منى 👋\nشكراً لاهتمامك بإعلان \"شقق التجمع\". معاك أحمد من دار السكن.\nلسه بتدور على شقة، في التجمع، 2 مليون – 3 مليون جنيه؟ قولي المنطقة والميزانية اللي تناسبك وأبعتلك أنسب الاختيارات.\n\n🏠 عندي حالياً: *#1* شقة للبيع — التجمع الخامس — 2.8 مليون جنيه · 3 غرف\nللتفاصيل والصور أرسل: #1\n\nلإيقاف رسائل العروض أرسل: وقف",
  );
  assert.match(campaigns.welcomeText(b.s, b.sara), /^أهلاً سارة 👋\nشكراً لاهتمامك\. معاك أحمد من دار السكن\.\nلسه بتدور على عقار؟/, "no ad, no wishes: still reads well");
  await b.send(".agent welcome مرحباً {name}، وصلنا طلبك من {ad}… هنكلمك قريب");
  assert.match(b.text(), /welcome: your own \(مرحباً \{name\}/);
  assert.match(campaigns.welcomeText(b.s, b.mona), /^مرحباً منى، وصلنا طلبك من بإعلان "شقق التجمع"… هنكلمك قريب/);
  await b.send(".agent welcome");
  assert.match(campaigns.welcomeText(b.s, b.mona), /^أهلاً منى 👋/, "an empty value goes back to the default");
});

test(".leads welcome: preview, then paced sending; contacted, opted-out and number-less clients skipped; replies tracked", async () => {
  const b = bot();
  await b.send(".leads welcome");
  let r = b.text();
  assert.match(r, /^👋 \*Welcome preview\* — 2 new client\(s\) nobody has contacted yet:\n▫️ #1 منى \(\+201002223333\) — شقق التجمع\n▫️ #2 سارة \(\+201003334444\)/, "oldest first");
  assert.doesNotMatch(r, /بدون رقم|قديم|أوقف/);
  assert.match(r, /Send: \.leads welcome go$/);

  await b.send(".leads welcome go");
  assert.match(b.text(), /▶️ Welcome #1 started: 2 new client\(s\)/);
  await b.send(".leads welcome go");
  assert.match(b.text(), /A welcome is already being sent/);

  assert.deepEqual(campaigns.get(b.s, 1).queue, [b.mona.id, b.sara.id]);
  assert.equal(await campaigns.tick(b.app, NOON, () => 0), "sent");
  assert.match(b.sentTo(jid(b.mona.phone)).at(-1).content.text, /^أهلاً منى 👋/);
  // Sara is contacted by hand before her turn: she's skipped.
  await b.send(`.lead send ${b.sara.id} 1`);
  assert.equal(await campaigns.tick(b.app, NOON + 2 * 60 * 1000, () => 0), "done");
  let mona = leads.get(b.s, b.mona.id);
  assert.equal(mona.status, "contacted");
  assert.ok(mona.welcomedAt);
  assert.match(mona.history.at(-1).text, /أُرسلت له رسالة ترحيب/);
  assert.match(b.sentTo(ME).at(-1).content.text, /📣 ترحيب #1 بالعملاء الجدد: ✅ 1 أُرسلت · ⏭️ 1 تخطي من 2/);

  await b.send(`.lead ${b.mona.id}`);
  assert.match(b.text(), /📤 آخر إرسال: رسالة الترحيب — .* \(لم يرد بعد\)/);
  await b.send("أيوه لسه بدور، ميزانيتي 3 مليون", jid(b.mona.phone));
  mona = leads.get(b.s, b.mona.id);
  assert.equal(mona.replied, true);
  assert.ok(mona.history.some((h) => h.text === "ردّ على رسالة الترحيب"));
  await b.send(".leads welcome");
  assert.match(b.text(), /No new client to welcome/);
});
