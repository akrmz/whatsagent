"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const requests = require("../src/services/requests");
const owners = require("../src/services/owners");
const sellers = require("../src/services/sellers");
const assistant = require("../src/services/assistant");

// B-25: optional words between `\s*` in the parsers' patterns backtracked on long runs of
// spaces. "عايز شقة قسط" and 285 spaces took 6 seconds in requests.detect, freezing the bot for
// every such message from anyone (with .agent requests on, or in a watched brokers' group).
const state = { store: (_n, d) => ({ data: JSON.parse(JSON.stringify(d)), update(fn) { return fn(this.data); } }) };
const PARSERS = {
  "requests.detect": (t) => requests.detect(t),
  "leads.parseLeadText": (t) => leads.parseLeadText(t),
  "re.parseListingText": (t) => re.parseListingText(t),
  "re.search": (t) => re.search(state, t, []),
  "re.monthlyIn": (t) => re.monthlyIn(t),
  "re.extractFree": (t) => re.extractFree(t),
  "owners.classify": (t) => owners.classify(t),
  "sellers.isSellerIntent": (t) => sellers.isSellerIntent(t),
  "assistant.asksForHuman": (t) => assistant.asksForHuman(t),
  "drafts.splitContacts": (t) => require("../src/services/drafts").splitContacts(t, "201011112222"), // channel and forwarded posts
};
const WORDS = ["عايز شقة قسط", "قسط", "monthly", "مقدم", "بمقدم", "استلام", "تسليم", "السعر", "في", "على", "حتى", "اقل من", "الدور", "للتواصل", "+20", "0100"];
const PADS = [" ".repeat(290), " \n".repeat(140), "\t".repeat(290), "1 ".repeat(145), "\n".repeat(290)];

test("the parsers of what strangers write take milliseconds, not seconds, on long runs of whitespace", () => {
  for (const f of Object.values(PARSERS)) f("عايز شقة في التجمع"); // compile the patterns first
  const slow = [];
  for (const [name, f] of Object.entries(PARSERS)) {
    for (const w of WORDS) {
      for (const pad of PADS) {
        const t = `${w}${pad}x`.slice(0, 300);
        const start = process.hrtime.bigint();
        f(t);
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        if (ms > 300) slow.push(`${name} "${w}" ${JSON.stringify(pad.slice(0, 2))}: ${Math.round(ms)} ms`);
      }
    }
  }
  assert.deepEqual(slow, []);
});

test("squeezing whitespace doesn't change what is read", () => {
  assert.equal(re.squeeze("قسط   40\t\tألف \n\n  في الشهر"), "قسط 40 ألف\nفي الشهر");
  const f = leads.parseLeadText("عايزة شاليه   في الساحل\n\n\nمقدم    مليون   وقسط  40   ألف");
  assert.deepEqual([f.type, f.downMax, f.monthlyMax], ["شاليه", 1e6, 4e4]);
  assert.equal(re.monthlyIn("القسط      الشهري    في حدود   50 ألف").value, 5e4);
  assert.deepEqual(re.parseListingText("النوع:   شقة\n\n\nالسعر:    3   مليون").price, 3e6);
});
