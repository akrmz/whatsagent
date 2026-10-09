"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const viewings = require("../src/services/viewings");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const OWNER = "201001234567@s.whatsapp.net";
const GROUP = "120363000000000011@g.us";
const DAY = 86400 * 1000;
const HOUR = 3600 * 1000;

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
    d.handleMessage(sock, { key: { id: `R${++n}`, remoteJid: chat || from, ...(chat ? { participant: from } : {}), fromMe: false }, pushName: "x", message: { conversation: text } });
  return { app, sock, send, s: app.state, text: () => sock.sent.at(-1).content.text || "", sentTo: (jid) => sock.sent.filter((m) => m.jid === jid) };
}

test(".listing report: the owner's marketing report, previewed in private, sent once a day, without clients' details", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T09:00:00Z") });
  const b = bot();
  const s = b.s;
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.5 مليون\nالمساحة: 150\nالمالك: أبو أحمد 01001234567"); // #1
  for (const price of [2.7e6, 2.8e6, 2.9e6]) re.add(s, { type: "شقة", deal: "بيع", location: "التجمع الخامس", price, size: 150 }, ME); // #2–#4: similar, cheaper
  leads.add(s, { name: "منى", phone: "201099998888" }, ME); // #1
  leads.add(s, { name: "كريم", phone: "201077776666" }, ME); // #2
  leads.markSent(s, 1, 1, ME, "أُرسل له العقار #1");
  leads.markSent(s, 2, 1, ME, "أُرسل له العقار #1");
  await b.send(".listing 1", { from: CLIENT }); // a client's view

  viewings.add(s, { lead: 1, listing: 1, at: Date.now() + DAY, chat: ME, by: ME }); // viewing #1
  viewings.add(s, { lead: 2, listing: 1, at: Date.now() + DAY + HOUR, chat: ME, by: ME }); // viewing #2
  t.mock.timers.setTime(Date.now() + DAY + 3 * HOUR);
  await b.send(".viewing done 1 liked عجبها بس شايفة السعر عالي، كلميني 01099998888");
  await b.send(".viewing done 1 thinking السعر عالي شوية"); // recorded again: replaces the first
  await b.send(".viewing done 2 noshow اتصلت بيه على 01077776666 مردش");
  await b.send(".listing edit 1 السعر: 3.2 مليون");
  t.mock.timers.setTime(Date.parse("2026-10-11T10:00:00Z"));

  const before = b.sock.sent.length;
  await b.send(".listing report 1");
  const r = b.text();
  assert.match(r, /^📊 \*Report for the owner of #1\* — preview, not sent yet:\n\nأهلاً أبو أحمد 👋\n📊 تقرير تسويق شقة في التجمع الخامس \(#1\) لحد النهارده:/);
  assert.match(r, /💰 السعر المعروض: 3,200,000 .+ \(بعد التخفيض من 3,500,000 .+\)\n📅 معروض من 10 يوم/);
  assert.match(r, /📣 اتبعت لـ 2 عميل مناسب\n👀 1 مشاهدة\n🏠 المعاينات: 2\n {3}🤔 بيفكر 1 · 🚫 لم يحضر 1/);
  assert.match(r, /💬 آراء اللي عاينوا:\n• اتصلت بيه على \[رقم\] مردش\n• السعر عالي شوية\n/, "one entry per viewing (the latest), newest first, numbers masked");
  assert.match(r, /📈 سعر المتر 21,333 .+ — أعلى من المتوسط بـ 14% \(مقارنة بـ 3 عقار مشابه في المنطقة\)/);
  assert.match(r, /Send it to the owner \(أبو أحمد, \+201001234567\): \.listing report 1 send$/);
  assert.doesNotMatch(r.split("\n\nSend it")[0].replace(/^[\s\S]*?preview, not sent yet:/, ""), /منى|كريم|201099998888|201077776666/, "no client names or numbers");
  assert.equal(b.sock.sent.length, before + 1, "a preview only");

  await b.send(".listing report 1", { chat: GROUP });
  assert.match(b.text(), /private chat with the bot/);
  assert.doesNotMatch(b.text(), /أبو أحمد|201001234567/);
  await b.send(".listing report 1 send", { from: CLIENT });
  assert.equal(b.sentTo(OWNER).length, 0, "clients can't send it");

  const updated = re.get(s, 1).updated;
  await b.send(".listing report 1 send");
  assert.match(b.text(), /📤 Sent the marketing report for #1 to أبو أحمد \(\+201001234567\)\./);
  const toOwner = b.sentTo(OWNER);
  assert.equal(toOwner.length, 1);
  assert.match(toOwner[0].content.text, /^أهلاً أبو أحمد 👋\n📊 تقرير تسويق/);
  assert.match(toOwner[0].content.text, /لو فيه أي تغيير في السعر أو الحالة ابعتهولي هنا 🙏/);
  assert.doesNotMatch(toOwner[0].content.text, /منى|كريم|201099998888|201077776666|Send it/);
  assert.equal(re.get(s, 1).updated, updated, "a report isn't an update of the listing");

  await b.send(".listing report 1 send");
  assert.match(b.text(), /already got a report today/);
  assert.equal(b.sentTo(OWNER).length, 1);
  t.mock.timers.setTime(Date.now() + 21 * HOUR);
  await b.send(".listing report 1 ابعت");
  assert.equal(b.sentTo(OWNER).length, 2, "the next day it can go again");
  t.mock.timers.reset();
});

test(".listing report: a new listing with no activity yet, and one without an owner number", async () => {
  const b = bot();
  re.add(b.s, { type: "فيلا", deal: "إيجار", location: "الشيخ زايد", price: 80000 }, ME); // #1
  await b.send(".listing report 1");
  const r = b.text();
  assert.match(r, /أهلاً 👋\n📊 تقرير تسويق فيلا في الشيخ زايد \(#1\)/);
  assert.match(r, /80,000 .+ شهرياً\n📅 معروض من النهارده\n\n📣 لسه بادئين التسويق/);
  assert.doesNotMatch(r, /📈/, "no market comparison for rentals");
  assert.match(r, /To send it, add the owner's number: \.listing edit 1 المالك:/);
  await b.send(".listing report 1 send");
  assert.match(b.text(), /#1 has no owner number/);
  await b.send(".listing report 9");
  assert.match(b.text(), /There is no listing #9/);
});

const campaigns = require("../src/services/campaigns");
const ownerReport = require("../src/services/ownerreport");
const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+03:00`);

test(".agent ownerreports on: on Saturdays from the sending hours, one paced report per owner with news; owners can stop them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at("2026-10-01", "12:00") });
  const b = bot();
  const s = b.s;
  const owner = (n, extra = {}) => re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, owner: { name: `مالك ${n}`, phone: `20100000000${n}` }, ...extra }, ME);
  const busy = (id) => re.count(s, id, "sent");
  owner(1); busy(1); // #1: due
  owner(2); // #2: nothing to report
  owner(3); busy(3); re.update(s, 3, { status: "sold" }); // #3: sold
  owner(4); busy(4); // #4: reported 2 days before
  owner(5); busy(5); // #5: its owner said stop
  re.add(s, { type: "شقة", deal: "بيع", location: "التجمع", price: 3e6 }, ME); busy(6); // #6: no owner number
  t.mock.timers.setTime(at("2026-10-09", "20:00"));
  owner(7); busy(7); // #7: added the day before: too new
  re.update(s, 4, { reportedAt: at("2026-10-08", "12:00") }, re.get(s, 4).updated);

  await b.send("وقف التقارير", { from: "201000000005@s.whatsapp.net" });
  assert.equal(b.text(), "✅ تمام، مش هتوصلك تقارير تاني. لو حبيت ترجعها ابعت: اشتراك التقارير");
  const n = b.sock.sent.length;
  await b.send("وقف التقارير", { from: "201000000005@s.whatsapp.net" });
  assert.equal(b.sock.sent.length, n, "a repeat gets no reply");
  await b.send(".listing report 5 send");
  assert.match(b.text(), /asked not to get reports/);
  assert.equal(b.sentTo("201000000005@s.whatsapp.net").length, 1, "only the confirmation");

  assert.deepEqual(ownerReport.weeklyTargets(s, at("2026-10-10", "10:00")).map((l) => l.id), [1]);
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "10:30"), () => 0), "idle", "off by default");
  await b.send(".agent ownerreports on");
  assert.match(b.text(), /ownerreports: on/);
  await b.send(".autopilot");
  assert.match(b.text(), /✅ تقرير أسبوعي لملاك العقارات \(السبت\) — 1 مستحق/);

  assert.equal(await campaigns.tick(b.app, at("2026-10-09", "11:00"), () => 0), "idle", "Fridays: nothing");
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "09:30"), () => 0), "hours", "Saturday, before the sending hours");
  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "10:00"), () => 0), "sent");
  const report = b.sentTo("201000000001@s.whatsapp.net");
  assert.equal(report.length, 1);
  assert.match(report[0].content.text, /^أهلاً مالك 1 👋\n📊 تقرير تسويق شقة في التجمع \(#1\)[\s\S]*📣 اتبعت لـ 1 عميل مناسب[\s\S]*\n\nلو مش حابب توصلك التقارير دي ابعت: وقف التقارير$/);
  assert.equal(re.get(s, 1).reportedAt, at("2026-10-10", "10:00"));
  assert.match(b.sentTo(ME).at(-1).content.text, /^📣 تقارير الملاك #\d+: ✅ 1 أُرسلت من 1/, "the owner is told when it's done");
  for (const p of ["201000000002", "201000000003", "201000000004", "201000000005", "201000000007"]) assert.equal(b.sentTo(`${p}@s.whatsapp.net`).filter((m) => /تقرير تسويق/.test(m.content.text || "")).length, 0, p);

  assert.equal(await campaigns.tick(b.app, at("2026-10-10", "15:00"), () => 0), "idle", "once on the day");
  await b.send("اشتراك التقارير", { from: "201000000005@s.whatsapp.net" });
  assert.match(b.text(), /هتوصلك تقارير التسويق تاني/);
  assert.equal(await campaigns.tick(b.app, at("2026-10-17", "10:00"), () => 0), "sent", "next Saturday");
  assert.deepEqual(campaigns.running(s).flatMap((c) => c.queue), [4, 5, 7], "#1 again, then the others now due");
  t.mock.timers.reset();
});

test("'وقف التقارير' from someone who owns no listing is not answered as an owner", async () => {
  const b = bot();
  await b.send("وقف التقارير", { from: CLIENT });
  assert.doesNotMatch(b.sock.sent.at(-1)?.content.text || "", /التقارير/);
  assert.equal(ownerReport.reportsOff(b.s, "201099998888"), false);
  assert.equal(ownerReport.reportsWord("وقف التقارير."), "stop");
  assert.equal(ownerReport.reportsWord("ايقاف تقارير"), "stop");
  assert.equal(ownerReport.reportsWord("اشتراك التقارير"), "start");
  assert.equal(ownerReport.reportsWord("وقف"), null, "a plain وقف is the clients' offers opt-out");
});
