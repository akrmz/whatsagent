"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { UserError } = require("../src/core/errors");
const { files, groupData } = require("../src/services/settings");
const { OWNER, ALL_OFF, makeApp, makeSock, makeMsg } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";

function commandSet(defs) {
  const byName = new Map();
  const list = defs.map((d) => ({
    aliases: [],
    usage: "",
    permission: "user",
    groupOnly: false,
    privateOnly: false,
    botAdmin: false,
    hidden: false,
    requires: [],
    cooldown: 0,
    ...d,
  }));
  for (const c of list) for (const k of [c.name, ...c.aliases]) byName.set(k, c);
  return { byName, list, disabled: [] };
}

function setup({ defs = [], listeners, participants = [] } = {}) {
  const ran = [];
  const commands = commandSet(
    defs.length
      ? defs
      : [
          { name: "hello", aliases: ["hi"], category: "t", description: "d", run: async (ctx) => ran.push(["hello", ctx.args, ctx.text]) },
          { name: "secret", category: "t", description: "d", permission: "owner", run: async () => ran.push(["secret"]) },
          { name: "mod", category: "t", description: "d", permission: "groupAdmin", run: async () => ran.push(["mod"]) },
          { name: "kicker", category: "t", description: "d", permission: "groupAdmin", botAdmin: true, run: async () => ran.push(["kicker"]) },
          { name: "slow", category: "t", description: "d", cooldown: 60, run: async () => ran.push(["slow"]) },
          { name: "oops", category: "t", description: "d", run: async () => { throw new UserError("Nice message"); } },
          { name: "boom", category: "t", description: "d", run: async () => { throw new Error("/secret/path leaked"); } },
        ],
  );
  const app = makeApp({ commands, listeners });
  const sock = makeSock({ participants });
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const lastText = () => sock.sent.at(-1)?.content?.text;
  return { app, sock, dispatcher, send, ran, lastText };
}

test("runs a command by name or alias with original-case arguments", async () => {
  const t = setup();
  await t.send({ text: ".hello World  Foo", chat: USER });
  await t.send({ text: ".  HI there", chat: USER });
  assert.deepEqual(t.ran, [
    ["hello", ["World", "Foo"], "World  Foo"],
    ["hello", ["there"], "there"],
  ]);
});

test("owner-only command is refused for others and runs for the owner and fromMe", async () => {
  const t = setup();
  await t.send({ text: ".secret", chat: USER });
  assert.match(t.lastText(), /only for the bot owner/);
  await t.send({ text: ".secret", chat: `${OWNER}@s.whatsapp.net` });
  await t.send({ text: ".secret", chat: USER, fromMe: true });
  assert.deepEqual(t.ran, [["secret"], ["secret"]]);
});

test("group-admin commands: groups only, admins allowed, members refused", async () => {
  const participants = [{ id: ADMIN, admin: "admin" }, { id: USER, admin: null }];
  const t = setup({ participants });
  await t.send({ text: ".mod", chat: USER });
  assert.match(t.lastText(), /only be used in groups/);
  await t.send({ text: ".mod", chat: GROUP, sender: USER });
  assert.match(t.lastText(), /Only group admins/);
  await t.send({ text: ".mod", chat: GROUP, sender: ADMIN });
  assert.deepEqual(t.ran, [["mod"]]);
});

test("botAdmin commands are refused when the bot is not a group admin", async () => {
  const t = setup({ participants: [{ id: ADMIN, admin: "admin" }] });
  await t.send({ text: ".kicker", chat: GROUP, sender: ADMIN });
  assert.match(t.lastText(), /make the bot a group admin/);
  assert.deepEqual(t.ran, []);
});

test("cooldown: second use is refused once with a notice, then silently; owner exempt", async () => {
  const t = setup();
  await t.send({ text: ".slow", chat: USER });
  await t.send({ text: ".slow", chat: USER });
  const notices = t.sock.sent.filter((s) => /Please wait/.test(s.content.text || "")).length;
  await t.send({ text: ".slow", chat: USER });
  assert.equal(t.sock.sent.filter((s) => /Please wait/.test(s.content.text || "")).length, notices);
  assert.equal(notices, 1);
  await t.send({ text: ".slow", chat: `${OWNER}@s.whatsapp.net` });
  await t.send({ text: ".slow", chat: `${OWNER}@s.whatsapp.net` });
  assert.equal(t.ran.length, 3);
});

test("private mode: only owner/sudo can run commands", async () => {
  const t = setup();
  t.app.state.setPublic(false);
  await t.send({ text: ".hello", chat: USER });
  assert.equal(t.ran.length, 0);
  await t.send({ text: ".hello", chat: `${OWNER}@s.whatsapp.net` });
  assert.equal(t.ran.length, 1);
});

test("banned users are ignored; owners can never be banned", async () => {
  const t = setup();
  files.banned(t.app.state).update((l) => l.push(USER, `${OWNER}@s.whatsapp.net`));
  await t.send({ text: ".hello", chat: USER });
  await t.send({ text: ".hello", chat: `${OWNER}@s.whatsapp.net` });
  assert.equal(t.ran.length, 1);
});

test("UserError text is shown; other errors are hidden behind a generic message", async () => {
  const t = setup();
  await t.send({ text: ".oops", chat: USER });
  assert.equal(t.lastText(), "❌ Nice message");
  await t.send({ text: ".boom", chat: USER });
  assert.match(t.lastText(), /Something went wrong/);
  assert.doesNotMatch(t.lastText(), /secret|path/);
});

test("messages the bot sent itself are never processed (no loops)", async () => {
  const t = setup();
  const msg = makeMsg({ text: ".hello", chat: USER });
  t.app.sentIds.set(msg.key.id, true);
  await t.dispatcher.handleMessage(t.sock, msg);
  assert.equal(t.ran.length, 0);
});

test("unknown commands and plain text go to post listeners; a pre listener can stop everything", async () => {
  const seen = [];
  const listeners = {
    byEvent: new Map([
      ["message:pre", [{ name: "gate", priority: 1, run: async (ctx) => (ctx.body === "blocked" ? "stop" : undefined) }]],
      ["message:post", [{ name: "post", priority: 1, run: async (ctx) => seen.push(ctx.body) }]],
    ]),
  };
  const t = setup({ listeners });
  await t.send({ text: "hello there", chat: USER });
  await t.send({ text: ".nosuchcommand", chat: USER });
  await t.send({ text: "blocked", chat: USER });
  assert.deepEqual(seen, ["hello there", ".nosuchcommand"]);
});

test("real moderation listener: antilink deletes a member's link but not an admin's", async () => {
  const { loadListeners } = require("../src/core/loader");
  const { LISTENERS_DIR } = require("../src/main");
  const listeners = loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF });
  const participants = [
    { id: "15550000009@s.whatsapp.net", admin: "admin" }, // the bot
    { id: ADMIN, admin: "admin" },
    { id: USER, admin: null },
  ];
  const t = setup({ listeners, participants });
  groupData(t.app.state).update((d) => (d.antilink[GROUP] = { enabled: true, action: "delete" }));
  await t.send({ text: "visit example.com now", chat: GROUP, sender: ADMIN });
  assert.equal(t.sock.sent.filter((s) => s.content.delete).length, 0);
  await t.send({ text: "visit example.com now", chat: GROUP, sender: USER });
  assert.equal(t.sock.sent.filter((s) => s.content.delete).length, 1);
});
