"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const re = require("../src/services/realestate");
const leads = require("../src/services/leads");
const assistant = require("../src/services/assistant");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const strip = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "notes"));

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
  const send = (text) => d.handleMessage(sock, { key: { id: `Q${++n}`, remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: text } });
  return { s: app.state, send, text: () => sock.sent.at(-1).content.text || "" };
}

/** Three chalets in instalments (100k, 60k and 35k a month), one plan without years, one cash. */
function catalogue(s) {
  const add = (f) => re.add(s, { type: "شاليه", deal: "بيع", location: "الساحل الشمالي", ...f }, ME).id;
  return {
    dear: add({ price: 8e6, down: 2e6, years: 5 }), // 100,000 a month
    mid: add({ price: 5.6e6, down: 1.28e6, years: 6 }), // 60,000
    cheap: add({ price: 3.1e6, down: 1e6, years: 5 }), // 35,000
    noYears: add({ price: 4e6, down: 1e6 }), // instalment unknown
    cash: add({ price: 3e6 }),
  };
}

test("a buyer's monthly instalment is read from a sentence, a label or the assistant, and isn't taken for the budget", () => {
  const s = strip(leads.parseLeadText("عايزة شاليه في الساحل مقدم مليون وقسط 40 ألف"));
  assert.deepEqual([s.type, s.downMax, s.monthlyMax, s.max, s.min], ["شاليه", 1e6, 4e4, undefined, undefined]);
  const f = leads.parseLeadText("عايز شقة في التجمع أقدر أدفع 50 ألف في الشهر");
  assert.equal(f.monthlyMax, 5e4);
  assert.equal(f.max, undefined, "50 ألف a month isn't a 50,000 budget");
  assert.equal(leads.parseLeadText("النوع: شقة\nالقسط: 45 ألف").monthlyMax, 45e3);
  assert.equal(leads.parseLeadText("عايز شقة للإيجار في المعادي 15 ألف في الشهر").monthlyMax, undefined, "for a rental, a month's amount is the rent");
  assert.equal(leads.parseLeadText("عايز شقة في التجمع ميزانية 3 مليون").monthlyMax, undefined);
  assert.equal(assistant.parseWants("type=شاليه; monthly=40000").monthlyMax, 40000);
  assert.equal(leads.budgetText({ downMax: 1e6, monthlyMax: 4e4 }, "جنيه"), "مقدم حتى 1 مليون جنيه · قسط حتى 40 ألف جنيه شهرياً");
});

test("matching by the monthly instalment: units whose instalment they can pay, not cash ones or plans without years", () => {
  const b = bot();
  const ids = catalogue(b.s);
  const ids2 = (lead) => leads.matchingListings(b.s, { type: "شاليه", deal: "بيع", ...lead }).map((x) => x.listing.id);
  assert.deepEqual(ids2({ monthlyMax: 6e4 }), [ids.cheap, ids.mid], "35k and 60k a month; not 100k, not the plan without years, not cash");
  assert.deepEqual(ids2({ monthlyMax: 6e4, downMax: 1e6 }), [ids.cheap], "both limits: 60k's down payment is 1.28M");
  assert.deepEqual(ids2({ monthlyMax: 5.6e4 }), [ids.cheap, ids.mid], "10% over is still shown …");
  assert.equal(leads.fits({ monthlyMax: 5.6e4 }, re.get(b.s, ids.mid)).over, true, "… marked over budget");
  assert.ok(ids2({ max: 3e6, monthlyMax: 3e4 }).includes(ids.cash), "with a cash budget too, either way fits");
  const lead = leads.add(b.s, { name: "منى", phone: "201001110001", type: "شاليه", deal: "بيع", monthlyMax: 6e4 }, ME);
  assert.deepEqual(leads.matchingLeads(b.s, re.get(b.s, ids.cheap)).map((x) => x.lead.id), [lead.id], "and the other way: the clients a listing suits");
  assert.equal(re.monthlyOf(re.get(b.s, ids.noYears)), null);
});

test(".listings قسط 40 ألف finds the units whose monthly instalment is at most that", async () => {
  const b = bot();
  const ids = catalogue(b.s);
  await b.send(".listings شاليه قسط 60 ألف");
  const r = b.text();
  assert.match(r, /^🏠 \*2 available\*/);
  assert.match(r, new RegExp(`#${ids.cheap}\\*`));
  assert.match(r, new RegExp(`#${ids.mid}\\*`));
  assert.doesNotMatch(r, new RegExp(`#(${ids.dear}|${ids.noYears}|${ids.cash})\\*`));
});
