"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const help = require("../src/services/help");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const everything = new Proxy({}, { get: () => true, has: () => true });

test("help sections by English or Arabic name, with or without ال", () => {
  const { list } = loadCommands(COMMANDS_DIR, { capabilities: everything });
  const cases = { realestate: "realestate", "real estate": "realestate", عقارات: "realestate", العقارات: "realestate", إسلاميات: "islamic", الاسلاميات: "islamic", الأدوات: "tools", تحميل: "download", "الذكاء الاصطناعي": "ai", ألعاب: "games", downloads: "download" };
  for (const [q, want] of Object.entries(cases)) assert.equal(help.findCategory(q, list), want, q);
  assert.equal(help.findCategory("ping", list), null, "a command name is not a section");
});

test(".help عقارات opens the section from chat", async () => {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({ commands: loaded, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock();
  app.sock = sock;
  await createDispatcher(app).handleMessage(sock, { key: { id: "H1", remoteJid: "201011112222@s.whatsapp.net", fromMe: false }, pushName: "x", message: { conversation: ".help عقارات" } });
  const reply = sock.sent.at(-1).content;
  assert.match(reply.text || reply.caption || "", /Real estate · عقارات/);
});

test("help messages stay well under WhatsApp's size limit as commands grow", () => {
  const { list } = loadCommands(COMMANDS_DIR, { capabilities: everything });
  for (const level of ["user", "owner"]) {
    const overview = help.renderOverview({ commands: list, prefix: ".", botName: "Bot", version: "x", level });
    const menu = help.renderMenu({ commands: list, prefix: ".", botName: "Bot", version: "x", level });
    assert.ok(overview.length < 2000, `overview ${overview.length} chars`);
    assert.ok(String(menu).length < 30000, `menu ${String(menu).length} chars`);
  }
});
