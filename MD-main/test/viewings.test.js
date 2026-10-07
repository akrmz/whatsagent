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

test("type and sale/rent are whole words: districts and floors are not property words", () => {
  const t = (s) => [re.typeIn(s), re.dealIn(s)];
  assert.deepEqual(t("شقة للإيجار في حي الربيع"), ["شقة", "إيجار"], "الربيع is not بيع");
  assert.deepEqual(t("المحلة الكبرى"), [null, null], "المحلة is not محل");
  assert.deepEqual(t("الدور الأرضي"), [null, null], "الأرضي is not أرض");
  assert.deepEqual(t("يبيع شقته"), [null, null], "the verb يبيع is not the deal");
  assert.deepEqual(t("للبيع"), [null, "بيع"]);
  assert.deepEqual(t("الشقة"), ["شقة", null]);
  assert.deepEqual(t("وفيلا بالإيجار"), ["فيلا", "إيجار"]);
  assert.deepEqual(t("محل للبيع"), ["محل", "بيع"]);
  assert.deepEqual(t("Villa for rent"), ["فيلا", "إيجار"]);
  assert.deepEqual(t("my parent rented"), [null, null], "rent inside other words");
  assert.deepEqual(
    { ...re.parseListingText("شقة للإيجار\nالمنطقة: المحلة الكبرى - حي الربيع\nالدور: الأرضي\nالسعر: 5000") },
    { type: "شقة", deal: "إيجار", location: "المحلة الكبرى - حي الربيع", floor: "الأرضي", price: 5000 },
  );
});

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
  const send = (text, from = ME) => d.handleMessage(sock, { key: { id: `M${++n}`, remoteJid: from, fromMe: false }, pushName: "x", message: { conversation: text } });
  const last = () => sock.sent.at(-1).content.text || "";
  return { app, sock, send, last };
}

test("search filters are whole words too: a district called الربيع and the word كلية", async () => {
  const b = bot();
  await b.send(".listing add\nالنوع: شقة\nللإيجار\nالمنطقة: حي الربيع\nالسعر: 8 ألف");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: بجوار الكلية الحربية\nالسعر: 2 مليون");
  await b.send(".listings الربيع");
  assert.match(b.last(), /#1\* شقة للإيجار/, "found by the district, not taken as 'sale'");
  await b.send(".listings الكلية");
  assert.match(b.last(), /1 available[\s\S]*#2/, "كلية isn't 'all'");
});

test("viewings: booking, reminder an hour before, client confirmation, cancel", async () => {
  const b = bot();
  await b.send(".agent name أحمد العقاري");
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3 مليون");
  await b.send(".lead add\nالاسم: منى\nالموبايل: 01112223334\nالنوع: شقة");
  await b.send(".viewing add 1 1 3h ابعت");
  assert.match(b.last(), /Viewing booked\n🗓️ \*#1\*.*شقة التجمع الخامس \(#1\) مع منى \(#1\)/);
  assert.match(b.last(), /Confirmation sent to \+201112223334/);
  const confirmation = b.sock.sent.find((s) => s.jid === "201112223334@s.whatsapp.net");
  assert.match(confirmation.content.text, /^أهلاً منى 👋\nتم تأكيد موعد معاينة شقة في التجمع الخامس\n🗓️ /);
  assert.match(confirmation.content.text, /👤 أحمد العقاري/);
  assert.equal(leads.get(b.app.state, 1).status, "viewing");
  assert.match(leads.get(b.app.state, 1).history.at(-1).text, /موعد معاينة #1/);

  const v = viewings.get(b.app.state, 1);
  assert.equal(await viewings.runDue(b.app, v.at - 61 * 60 * 1000), 0, "not yet");
  assert.equal(await viewings.runDue(b.app, v.at - 59 * 60 * 1000), 1, "an hour before");
  assert.match(b.last(), /⏰ \*معاينة بعد 59 دقيقة\*[\s\S]*📞 \+201112223334/);
  assert.equal(await viewings.runDue(b.app, v.at - 30 * 60 * 1000), 0, "once");

  await b.send(".viewings");
  assert.match(b.last(), /المعاينات \(1\)/);
  await b.send(".viewing add 1 1 at 25:00");
  assert.match(b.last(), /When\?/);
  await b.send(".viewing del 1");
  assert.match(b.last(), /Viewing #1 cancelled/);
  await b.send(".viewing add 1 1 2h", "201099998888@s.whatsapp.net");
  assert.equal(viewings.upcoming(b.app.state).length, 0, "owner and sudo only");
});

test("a price cut names the clients whose budget it now fits", async () => {
  const b = bot();
  await b.send(".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع\nالسعر: 3.6 مليون");
  await b.send(".lead add\nالاسم: أحمد\nالموبايل: 01001234567\nالنوع: شقة\nالميزانية: 2.5-3 مليون");
  await b.send(".lead add\nالاسم: سارة\nالموبايل: 01002223333\nالنوع: شقة\nالميزانية: 3.5-4 مليون");
  await b.send(".listing edit 1 السعر: 3.2 مليون");
  assert.match(b.last(), /📉 السعر انخفض 11%/);
  assert.doesNotMatch(b.last(), /يناسب الآن/, "3.2m is still over Ahmed's 3m budget (only flagged ⚠️): not yet");
  await b.send(".listing edit 1 السعر: 2.9 مليون");
  assert.match(b.last(), /يناسب الآن ميزانية 1 من عملائك: #1 أحمد/);
  assert.doesNotMatch(b.last(), /سارة/, "Sara's budget already fitted");
  await b.send(".listing edit 1 السعر: 3 مليون");
  assert.doesNotMatch(b.last(), /📉/, "a price increase says nothing");
});

test("commission: rate, VAT on it, and your share", async () => {
  const b = bot();
  await b.send(".commission 3.5m 2.5%");
  assert.match(b.last(), /العمولة 2\.5%: \*87,500 جنيه\*/);
  await b.send(".commission 3.5 مليون 2.5% vat 14% share 50%");
  assert.match(b.last(), /ضريبة 14%: 12,250 جنيه → الإجمالي 99,750 جنيه/);
  assert.match(b.last(), /نصيبك 50%: \*43,750 جنيه\*/);
  await b.send(".commission 3.5m 50%");
  assert.match(b.last(), /Usage/);
});
