"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const tc = require("../src/services/timecalc");
const colors = require("../src/services/colors");
const pdf = require("../src/services/pdf");
const geo = require("../src/services/geo");
const whois = require("../src/commands/info/whois");
const { makeApp, makeSock, makeMsg, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";

function bot() {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env: { TIMEZONE: "Africa/Cairo" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  const d = createDispatcher(app);
  const send = (text) => d.handleMessage(sock, makeMsg({ text, chat: USER, sender: USER }));
  const last = () => sock.sent.at(-1).content;
  return { send, last };
}

test("time zones: offsets with daylight saving, and a local time turned into an instant", () => {
  const oct = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(tc.offsetMinutes("Africa/Cairo", oct), 180, "Egypt summer time");
  assert.equal(tc.offsetMinutes("Europe/London", oct), 60, "BST");
  assert.equal(tc.offsetMinutes("Australia/Sydney", oct), 660, "Sydney moved to summer time on 4 October");
  assert.equal(tc.offsetMinutes("Asia/Kolkata", oct), 330, "half-hour zone");
  const t = tc.zonedInstant("Africa/Cairo", { y: 2026, m: 10, d: 7 }, 15 * 60);
  assert.equal(new Date(t).toISOString(), "2026-10-07T12:00:00.000Z");
  assert.deepEqual(tc.parseTz("15:00 Cairo to London"), { minutes: 900, from: "Cairo", to: "London" });
  assert.deepEqual(tc.parseTz("9am New York to Tokyo"), { minutes: 540, from: "New York", to: "Tokyo" });
  assert.deepEqual(tc.parseTz("Riyadh Paris"), { minutes: null, from: "Riyadh", to: "Paris" });
  assert.throws(() => tc.parseTz("25:00 Cairo to London"), /15:00 or 3pm/);
});

test(".tz converts with the cities' own zones", async (t) => {
  const places = {
    cairo: { name: "Cairo", country: "Egypt", timezone: "Africa/Cairo", latitude: 30, longitude: 31 },
    london: { name: "London", country: "United Kingdom", timezone: "Europe/London", latitude: 51, longitude: 0 },
  };
  const original = geo.geocode;
  geo.geocode = async (q) => places[q.toLowerCase()];
  t.after(() => (geo.geocode = original));
  const b = bot();
  await b.send(".tz 15:00 Cairo to London");
  assert.match(b.last().text, /Cairo.*\*\w{3} \d{1,2} \w{3}, 15:00\*/);
  assert.match(b.last().text, /London.*\*\w{3} \d{1,2} \w{3}, 13:00\*/);
  assert.match(b.last().text, /London is 2 h behind Cairo/);
});

test("date calculator", () => {
  const today = { y: 2026, m: 10, d: 7 };
  assert.match(tc.daysAnswer("2026-12-31", today), /\*85 days\* \(2 months, 24 days; 12 weeks and 1 day\)/);
  assert.match(tc.daysAnswer("01/01/2026 31/12/2026", today), /\*364 days\*/);
  assert.match(tc.daysAnswer("+90", today), /Tuesday, 5 January 2027/);
  assert.match(tc.daysAnswer("-30", today), /Monday, 7 September 2026/);
  assert.match(tc.daysAnswer("2000-02-29", today), /Since [\s\S]*26 years, 7 months, 8 days/);
  assert.match(tc.daysAnswer("2026-10-07", today), /That's today/);
  assert.throws(() => tc.daysAnswer("31/02/2026", today), /not a real date/);
  assert.throws(() => tc.daysAnswer("someday", today), /Usage/);
});

test("colours: parsing, conversions and the readable text colour", async () => {
  assert.deepEqual(colors.parseColor("#09f"), { r: 0, g: 153, b: 255 });
  assert.deepEqual(colors.parseColor("rgb(255, 99, 71)"), { r: 255, g: 99, b: 71 });
  assert.deepEqual(colors.parseColor("Orange"), { r: 255, g: 165, b: 0 });
  assert.throws(() => colors.parseColor("rgb(300, 0, 0)"), /Give a colour/);
  const d = colors.describe(colors.parseColor("#1e90ff"));
  assert.deepEqual([d.hex, d.hsl, d.text], ["#1e90ff", "hsl(210, 100%, 56%)", "black"]);
  assert.equal(colors.describe(colors.parseColor("navy")).text, "white");
  const png = await colors.swatch(colors.parseColor("#1e90ff"));
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["png", 600, 300]);
});

test("pictures to PDF: valid structure, one page per picture, orientation follows the picture", async () => {
  const wide = await sharp({ create: { width: 800, height: 500, channels: 4, background: "#c0392b80" } }).png().toBuffer();
  const tallGray = await sharp({ create: { width: 400, height: 900, channels: 3, background: "#777" } }).grayscale().jpeg().toBuffer();
  const doc = await pdf.imagesToPdf([wide, tallGray]);
  const s = doc.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  assert.match(s, /\/Count 2/);
  assert.match(s, /\/MediaBox \[0 0 841\.89 595\.28\]/, "landscape page for the wide picture");
  assert.match(s, /\/MediaBox \[0 0 595\.28 841\.89\]/, "portrait page for the tall one");
  assert.equal((s.match(/\/ColorSpace \/DeviceRGB/g) || []).length, 2, "grayscale input stored as RGB too");
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  const offsets = [...s.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.ok(offsets.every((o, i) => s.slice(o).startsWith(`${i + 1} 0 obj`)), "the xref table points at every object");
});

test("whois: domain from a link or email; RDAP summary", () => {
  assert.equal(whois.domainOf("https://www.Wikipedia.org/wiki/x"), "www.wikipedia.org");
  assert.equal(whois.domainOf("user@github.com"), "github.com");
  assert.equal(whois.domainOf("1.2.3.4"), null);
  assert.equal(whois.domainOf("localhost"), null);
  const text = whois.summary(
    {
      ldhName: "GITHUB.COM",
      status: ["client transfer prohibited"],
      events: [
        { eventAction: "registration", eventDate: "2007-10-09T18:20:50Z" },
        { eventAction: "expiration", eventDate: "2099-10-09T18:20:50Z" },
      ],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]] }],
      nameservers: [{ ldhName: "DNS1.P08.NSONE.NET" }],
    },
    "github.com",
  );
  assert.match(text, /🌐 \*github\.com\*/);
  assert.match(text, /Registered: 2007-10-09/);
  assert.match(text, /Expires: 2099-10-09 \(in [\d,]+ days\)/);
  assert.match(text, /Registrar: MarkMonitor Inc\./);
  assert.match(text, /dns1\.p08\.nsone\.net/);
});

test(".topdf without a picture explains; cancel clears collected pages", async () => {
  const b = bot();
  await b.send(".topdf");
  assert.match(b.last().text, /Send a picture/);
  await b.send(".topdf add");
  assert.match(b.last().text, /Reply to a picture/);
  await b.send(".topdf cancel");
  assert.match(b.last().text, /discarded/);
});
