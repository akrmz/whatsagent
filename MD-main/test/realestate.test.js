"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const calc = require("../src/services/recalc");
const img = require("../src/services/reimages");
const { makeApp, makeSock, makeMsg, ALL_OFF, OWNER } = require("./helpers");

const CLIENT = "201099998888@s.whatsapp.net";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;

const POST = `شقة للبيع 🔥
▪️ النوع: شقة
📍 المنطقة: التجمع الخامس - كمبوند ميفيدا
💰 السعر: ٣٫٥ مليون
المساحة: 150 م
الغرف: 3
الحمامات: 2
الدور: الرابع
التشطيب: سوبر لوكس
قريبة من الجامعة الأمريكية`;

function bot(caps = ALL_OFF) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: caps });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: caps }), capabilities: caps });
  const sock = makeSock();
  app.sock = sock;
  const d = createDispatcher(app);
  const send = (text, from = OWNER_JID) => d.handleMessage(sock, makeMsg({ text, chat: from, sender: from }));
  const last = () => sock.sent.at(-1).content;
  return { app, send, last };
}

test("reading broker posts: Arabic/English labels, Arabic digits, millions, emoji bullets", () => {
  const p = re.parseListingText(POST);
  assert.deepEqual(
    { ...p },
    { type: "شقة", location: "التجمع الخامس - كمبوند ميفيدا", price: 3500000, size: 150, rooms: 3, baths: 2, floor: "الرابع", finishing: "سوبر لوكس", deal: "بيع", notes: "قريبة من الجامعة الأمريكية" },
  );
  assert.deepEqual(re.parseListingText("Villa for rent\nLocation: Sheikh Zayed\nPrice: 85k\nSize: 400 sqm\nBedrooms: 5"), { location: "Sheikh Zayed", price: 85000, size: 400, rooms: 5, type: "فيلا", deal: "إيجار" });
  assert.deepEqual(["3,500,000", "3.5 مليون", "750 ألف", "٢٥٠٠٠٠٠ جنيه"].map(re.parseAmount), [3500000, 3500000, 750000, 2500000]);
  assert.equal(re.shortAr(3500000), "3.5 مليون");
});

test("calculators: instalments, mortgage (annuity), price per metre, rental yield", () => {
  const i = calc.installments("3.5m 10% 8 quarterly maint 8%");
  assert.deepEqual([i.down, i.count, i.each, i.maintenance], [350000, 32, 98437.5, 280000]);
  const i2 = calc.installments("٣٫٥ مليون 350 ألف 5 شهري");
  assert.deepEqual([i2.down, i2.count, i2.each], [350000, 60, 52500]);
  assert.throws(() => calc.installments("3.5m 120% 8"), /0 to 99%/);
  const mo = calc.mortgage("1m 20% 12% 20");
  assert.equal(Math.round(mo.monthly * 100) / 100, 8808.69, "standard annuity table value");
  assert.equal(calc.mortgage("1m 0% 0% 10").monthly, 1000000 / 120);
  assert.equal(Math.round(calc.ppm("3.5 مليون 150").perMeter), 23333);
  const r = calc.roi("2 مليون 15 ألف");
  assert.deepEqual([r.yieldPct, Math.round(r.payback * 10) / 10], [9, 11.1]);
});

test("the catalogue from chat: agent, add, view, search, edit, status, flyer, permissions, delete", async () => {
  const b = bot();
  await b.send(".agent name أحمد العقاري");
  await b.send(".agent phone +20 100 123 4567");
  assert.match(b.last().text, /phone: \+20 100 123 4567/);

  await b.send(`.listing add\n${POST}`);
  assert.match(b.last().text, /Saved as \*#1\*/);
  assert.match(b.last().text, /💰 \*3,500,000 جنيه\* \(3\.5 مليون\)/);
  assert.match(b.last().text, /💵 سعر المتر: 23,333 جنيه/);
  assert.match(b.last().text, /👤 أحمد العقاري · 📞 \+20 100 123 4567/);
  await b.send(".listing add\nالنوع: فيلا\nللإيجار\nالمنطقة: الشيخ زايد\nالسعر: 85 ألف\nالمساحة: 400\nالغرف: 5");
  await b.send(".listing add\nالنوع: شقة\nالمنطقة: المعادي\nالسعر: 2.2 مليون\nالغرف: 2");

  await b.send(".listings شقة 2m-4m");
  assert.match(b.last().text, /2 available/);
  await b.send(".listings التجمع");
  assert.match(b.last().text, /1 available[\s\S]*#1\* شقة للبيع — التجمع/);
  await b.send(".listings ايجار 5 غرف");
  assert.match(b.last().text, /#2\* فيلا للإيجار/);
  await b.send(".listings <3m");
  assert.match(b.last().text, /#3/);
  assert.doesNotMatch(b.last().text, /#1\*/);

  await b.send(".listing edit 1 السعر: 3.4 مليون\nالدور: الخامس");
  assert.match(b.last().text, /Updated #1: price, floor/);
  assert.equal(re.get(b.app.state, 1).floor, "الخامس", "several lines at once");
  await b.send(".listing status 1 محجوز");
  assert.equal(re.get(b.app.state, 1).status, "reserved");
  await b.send(".listings التجمع");
  assert.match(b.last().text, /No listing matches/, "reserved ones only with all");
  await b.send(".listings all التجمع");
  assert.match(b.last().text, /⏳ محجوز/);

  await b.send(".listing 1", CLIENT);
  assert.match(b.last().text, /شقة للبيع\* — #1/, "clients can view");
  await b.send(".listing add\nالنوع: شقة", CLIENT);
  assert.match(b.last().text, /Only the owner and sudo users/);
  await b.send(".agent name hacker", CLIENT);
  assert.equal(re.agent(b.app.state).name, "أحمد العقاري");

  await b.send(".flyer 1", CLIENT);
  const meta = await sharp(b.last().image).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1350]);

  await b.send(".installments 3.5m 10% 8 quarterly maint 8%", CLIENT);
  assert.match(b.last().text, /المقدم \(10%\): \*350,000 جنيه\*/);
  assert.match(b.last().text, /القسط الربع سنوي: \*98,438 جنيه\* × 32 قسط/);
  assert.match(b.last().text, /وديعة الصيانة \(8%\): 280,000 جنيه/);
  await b.send(".mortgage 1m 20% 12% 20", CLIENT);
  assert.match(b.last().text, /القسط الشهري: \*8,809 جنيه\* × 240/);

  re.addPhoto(b.app.state, b.app.config, 1, await img.toListingJpeg(await sharp({ create: { width: 50, height: 40, channels: 3, background: "#888" } }).png().toBuffer()));
  const dir = require("node:path").join(b.app.config.paths.data, "listings", "1");
  assert.ok(fs.existsSync(`${dir}/1.jpg`));
  await b.send(".listing 1", CLIENT);
  assert.ok(b.app.sock.sent.some((s) => s.content.image && /#1/.test(s.content.caption || "")), "shown with its photo");
  await b.send(".listing del 1");
  assert.match(b.last().text, /Deleted #1/);
  assert.equal(fs.existsSync(dir), false, "photos removed too");
  assert.equal(re.get(b.app.state, 1), null);
});

test(".adcopy gives the AI only the listing's facts and the agent's contact", async () => {
  const b = bot({ ...ALL_OFF, ai: true });
  let prompt = "";
  b.app.ai = { ask: async (p) => ((prompt = p), "🏠 *فرصة!* …") };
  await b.send(".agent name أحمد العقاري");
  await b.send(`.listing add\n${POST}`);
  await b.send(".adcopy 1 short");
  assert.equal(b.last().text, "🏠 *فرصة!* …");
  assert.match(prompt, /التجمع الخامس - كمبوند ميفيدا/);
  assert.match(prompt, /3,500,000/);
  assert.match(prompt, /never invent/);
  assert.match(prompt, /at most 4 lines/);
  assert.match(prompt, /contact line exactly: أحمد العقاري/);
  assert.doesNotMatch(prompt, /🔖/, "the internal status isn't sent");
  await b.send(".adcopy 1", CLIENT);
  assert.doesNotMatch(b.last().text, /فرصة/, "sudo only");
});

test("watermark and flyer keep the phone number's digit groups in order (right-to-left layout)", async () => {
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#9cc3e6" } }).png().toBuffer();
  const out = await img.watermark(photo, "أحمد العقاري · +20 100 123 4567");
  assert.equal((await sharp(out).metadata()).width, 800);
  const src = fs.readFileSync(require.resolve("../src/services/reimages"), "utf8");
  assert.match(src, /\\u2066\$\{m\}\\u2069/, "numbers wrapped in Unicode isolates");
  assert.match(src, /direction="rtl" text-anchor="start"/);
});
