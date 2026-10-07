"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const net = require("../src/services/nettools");
const memes = require("../src/services/memes");
const tc = require("../src/services/timecalc");
const { split } = require("../src/commands/tools/split");

test("domain names from links, emails and IDNs; addresses and single names refused", () => {
  assert.equal(net.domainOf("https://www.Wikipedia.org/wiki/x"), "www.wikipedia.org");
  assert.equal(net.domainOf("user@github.com"), "github.com");
  assert.equal(net.domainOf("مثال.مصر"), "xn--mgbh0fb.xn--wgbh1c");
  assert.equal(net.domainOf("127.0.0.1"), null);
  assert.equal(net.domainOf("localhost"), null);
  assert.equal(net.domainOf(""), null);
});

test("DNS records are asked one type at a time, and missing types are left out", async () => {
  const order = [];
  const fake = {};
  for (const [name, value] of Object.entries({
    resolve4: ["93.184.215.14"],
    resolve6: [],
    resolveCname: Promise.reject(Object.assign(new Error("no data"), { code: "ENODATA" })),
    resolveMx: [{ priority: 20, exchange: "b.mx" }, { priority: 10, exchange: "a.mx" }],
    resolveNs: ["ns1.example"],
    resolveTxt: [["v=spf1 ", "-all"]],
  })) {
    value.catch?.(() => {});
    fake[name] = async () => {
      order.push(name);
      return value;
    };
  }
  const r = await net.lookup("example.com", fake);
  assert.deepEqual(r, { A: ["93.184.215.14"], MX: ["10 a.mx", "20 b.mx"], NS: ["ns1.example"], TXT: ["v=spf1 -all"] });
  assert.deepEqual(order, ["resolve4", "resolve6", "resolveCname", "resolveMx", "resolveNs", "resolveTxt"], "sequential");
});

test(".up and .ssl refuse names that point at the server itself", async () => {
  await assert.rejects(net.check("http://localhost/"), /not allowed/);
  await assert.rejects(net.certificate("localhost"), /not allowed/);
});

test("meme captions: top/bottom parsing, wrapping, picture size kept", async () => {
  assert.deepEqual(memes.parseCaption("when the code works | on the first try"), { top: "when the code works", bottom: "on the first try" });
  assert.deepEqual(memes.parseCaption("| bottom only"), { top: "", bottom: "bottom only" });
  assert.equal(memes.parseCaption(" | "), null);
  const long = memes.layout("a very long caption that goes on and on and on and on and on and on and on", 1024);
  assert.ok(long.lines.length <= 4 && long.size >= 1024 / 28);
  assert.deepEqual(memes.wrap("one two three", 8), ["one two", "three"]);
  const img = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#4a6fa5" } }).png().toBuffer();
  const out = await memes.caption(img, { top: "top <text> & more", bottom: "لما الكود يشتغل" });
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 1024, 796], "scaled to 1024 wide, aspect kept; < > & escaped");
});

test("month calendar: weekdays, leap years, week start, today marked", () => {
  const today = { y: 2026, m: 10, d: 7 };
  const oct = tc.monthGrid(tc.parseMonth("", today), today);
  assert.equal(oct.title, "October 2026");
  assert.equal(oct.text.split("\n")[0], " Mo  Tu  We  Th  Fr  Sa  Su");
  assert.equal(oct.text.split("\n")[1], "              1   2   3   4", "1 October 2026 is a Thursday");
  assert.match(oct.text, /\[7\]/);
  const feb = tc.monthGrid(tc.parseMonth("feb 2028 sun", today), today);
  assert.match(feb.text.split("\n")[0], /^ Su /);
  assert.match(feb.text, /29$/, "2028 is a leap year");
  assert.doesNotMatch(feb.text, /\[/, "today isn't in that month");
  assert.deepEqual(tc.parseMonth("12/2026 sat", today), { y: 2026, m: 12, start: 6 });
  assert.throws(() => tc.parseMonth("13 2026", today), /1–12/);
});

test("bill split adds up exactly, tips included", () => {
  assert.deepEqual(split("100 3"), { total: 10000, tip: 0, tipPct: 0, grand: 10000, people: 3, base: 3333, extra: 1 });
  const r = split("1,250.50 4 10%");
  assert.equal(r.grand, 137555);
  assert.equal(r.base * r.people + r.extra, r.grand);
  assert.equal(split("450 3 tip 12.5").grand, 50625);
  assert.throws(() => split("10 1"), /2 and 100 people/);
  assert.throws(() => split("hello"), /Usage/);
});
