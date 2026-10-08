"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const leads = require("../src/services/leads");
const csv = require("../src/services/csv");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";

test("the Excel export can't be made to run formulas by names, notes or form answers", async () => {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const commands = { list: loaded.list.map((c) => ({ ...c, cooldown: 0 })), byName: new Map([...loaded.byName].map(([k, c]) => [k, { ...c, cooldown: 0 }])), disabled: loaded.disabled };
  const app = makeApp({ env: { OWNER_NUMBERS: "201011112222" }, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  // A WhatsApp name or a lead-ads answer can be anything a stranger typed.
  leads.add(app.state, { name: '=HYPERLINK("http://example.invalid","اضغط")', phone: "201001110001", source: "@SUM(1+1)", notes: "+cmd|' /C calc'!A0" }, ME);
  leads.add(app.state, { name: "-2+3", phone: "201001110002", source: "فيسبوك" }, ME);
  await createDispatcher(app).handleMessage(sock, { key: { id: "X1", remoteJid: ME, fromMe: false }, pushName: "x", message: { conversation: ".export leads" } });
  const text = sock.sent.at(-1).content.document.toString("utf8");
  const rows = csv.records(text).rows;
  const byPhone = (p) => rows.find((r) => r.phone === p);
  const one = byPhone("+201001110001");
  assert.ok(one, "phone numbers keep their + and aren't changed");
  assert.equal(one.name, `'=HYPERLINK("http://example.invalid","اضغط")`);
  assert.equal(one.source, "'@SUM(1+1)");
  assert.equal(one.last_note, "'+cmd|' /C calc'!A0");
  assert.equal(byPhone("+201001110002").name, "'-2+3");
  for (const r of rows) for (const v of Object.values(r)) assert.doesNotMatch(v, /^[=@]|^[+-](?![\d\s.,]*$)/, `no cell may start a formula: ${v}`);

  // Importing the export back gives the original text (without the apostrophe).
  const { importCsv } = require("../src/commands/realestate/office");
  const fresh = makeApp({ env: { OWNER_NUMBERS: "201011112222" } });
  importCsv(fresh.state, text, "leads", { by: ME, ownerNumber: "201011112222" });
  assert.equal(leads.byPhone(fresh.state, "201001110001").name, '=HYPERLINK("http://example.invalid","اضغط")');
});
