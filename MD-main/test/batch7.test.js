"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher } = require("../src/core/dispatcher");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const reminders = require("../src/services/reminders");
const activity = require("../src/services/activity");
const backup = require("../src/services/backup");
const cookies = require("../src/services/cookies");
const { groupData, sudoList } = require("../src/services/settings");
const { makeApp, makeSock, makeMsg, OWNER, ALL_OFF } = require("./helpers");

const USER = "447911123456@s.whatsapp.net";
const ADMIN = "447911000001@s.whatsapp.net";
const GROUP = "120363000000000000@g.us";
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const BOT_JID = "15550000009@s.whatsapp.net";

function realBot({ env = {} } = {}) {
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const copies = new Map(loaded.list.map((c) => [c, { ...c, cooldown: 0 }]));
  const commands = { list: [...copies.values()], byName: new Map([...loaded.byName].map(([k, c]) => [k, copies.get(c)])), disabled: loaded.disabled };
  const app = makeApp({ env, commands, listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }) });
  const sock = makeSock({ participants: [{ id: ADMIN, admin: "admin" }, { id: USER }, { id: BOT_JID, admin: "admin" }] });
  sock.profilePictureUrl = async () => null;
  app.sock = sock;
  app.health.state = "open";
  const dispatcher = createDispatcher(app);
  const send = (opts) => dispatcher.handleMessage(sock, makeMsg(opts));
  const last = () => sock.sent.at(-1)?.content?.text || "";
  return { app, sock, dispatcher, send, last };
}

/** A message carrying a document (the fake download in each test returns `buffer`). */
function docMsg({ caption, chat = OWNER_JID }) {
  return {
    key: { id: `D${Math.random()}`, remoteJid: chat, fromMe: false },
    pushName: "Owner",
    message: { documentMessage: { caption, mimetype: "application/json", fileLength: 100, fileName: "b.json" } },
  };
}

// ---- greetings, announcements, weekdays -------------------------------------------------

test(".welcome test previews the real welcome (card + text)", async () => {
  const t = realBot();
  await t.send({ text: ".welcome set Hi {user}, we are {count} in {group}", chat: GROUP, sender: ADMIN });
  await t.send({ text: ".welcome test", chat: GROUP, sender: ADMIN });
  const msg = t.sock.sent.at(-1).content;
  assert.ok(Buffer.isBuffer(msg.image));
  assert.equal(msg.caption, "Hi @447911000001, we are 3 in Test group");
});

test("announcements: admins schedule them, they are sent as plain text without mentions", async () => {
  const t = realBot({ env: { TIMEZONE: "Africa/Cairo" } });
  await t.send({ text: ".announce every day at 08:00 Good morning ☀️", chat: GROUP, sender: USER });
  assert.match(t.last(), /Only group admins/);
  await t.send({ text: ".announce every day at 08:00 Good morning ☀️", chat: GROUP, sender: ADMIN });
  assert.match(t.last(), /Announcement #\d+ scheduled .*then every 1d/);
  const [a] = reminders.announcementsIn(t.app.state, GROUP);
  const firstDue = a.due; // a is the stored object: delivery moves it forward
  assert.equal(reminders.listFor(t.app.state, ADMIN).length, 0, "not one of the admin's personal reminders");
  await reminders.deliverDue(t.app, firstDue + 1000);
  const sent = t.sock.sent.at(-1);
  assert.deepEqual(sent.content, { text: "📢 Good morning ☀️" });
  assert.equal(reminders.announcementsIn(t.app.state, GROUP)[0].due, firstDue + 86400000);
  await t.send({ text: `.announce del ${a.id}`, chat: GROUP, sender: ADMIN });
  assert.equal(reminders.announcementsIn(t.app.state, GROUP).length, 0);
});

test("weekdays: 'every friday at 20:00', 'friday at 9am'; 'fridge' is not a day", () => {
  const now = Date.parse("2026-10-06T10:00:30Z"); // Tuesday 13:00:30 in Cairo
  const h = (t) => reminders.parseWhen(t, "Africa/Cairo", now);
  assert.equal(h("every friday at 20:00 x").every, 7 * 86400000);
  assert.equal(h("every friday at 20:00 x").ms, (3 * 24 + 7) * 3600000 - 30000);
  assert.equal(h("on tuesday at 14:00 x").ms, 3600000 - 30000);
  assert.equal(h("tuesday at 12:00 x").ms, (7 * 24 - 1) * 3600000 - 30000, "already passed today: next week");
  assert.equal(h("fridge is empty"), null);
});

// ---- inactive members ----------------------------------------------------------------------

test(".inactive lists quiet members by number without mentioning anyone", async () => {
  const t = realBot();
  const now = Date.now();
  activity.seen(t.app.state, GROUP, ADMIN, now);
  activity.seen(t.app.state, GROUP, USER, now - 10 * 86400000);
  assert.deepEqual(
    activity.inactive(t.app.state, GROUP, [{ id: ADMIN }, { id: USER }, { id: "4479110000@s.whatsapp.net" }], 7, undefined, now).map((m) => m.jid),
    ["4479110000@s.whatsapp.net", USER],
    "never-seen first, then oldest",
  );
  await t.send({ text: ".inactive 7", chat: GROUP, sender: ADMIN });
  const msg = t.sock.sent.at(-1).content;
  assert.match(msg.text, /\+447911123456 — 10d ago/);
  assert.equal(msg.mentions, undefined, "nobody is pinged");
});

// ---- backup / restore -------------------------------------------------------------------------

test("backup and restore round-trip lists, chat settings and cookies (full backups only)", async () => {
  const a = realBot();
  groupData(a.app.state).update((d) => d.sudo.push(USER));
  a.app.state.store("notes", {}).update((d) => (d[GROUP] = { rules: { text: "Be kind" } }));
  await a.send({ text: ".setvar BOT_NAME Backed Up", chat: OWNER_JID });
  await a.send({ text: ".setvar NEWSAPI_KEY secretsecret1234", chat: OWNER_JID });
  cookies.save(a.app.config, "youtube", cookies.parse("SID=a; LOGIN_INFO=b", "youtube").cookies);

  const plain = backup.create(a.app, { version: "x" });
  assert.ok(plain.files["notes.json"]);
  assert.equal(plain.files["env-overrides.json"], undefined, "no keys in a normal backup");
  assert.equal(Object.keys(plain.files).some((f) => f.startsWith("cookies/")), false);
  assert.doesNotMatch(JSON.stringify(plain), /secretsecret1234/);

  const full = Buffer.from(JSON.stringify(backup.create(a.app, { full: true, version: "x" })));
  const b = realBot();
  const done = await backup.restore(b.app, full);
  assert.ok(done.stores.includes("notes"));
  assert.deepEqual(sudoList(b.app.state), [USER]);
  assert.equal(b.app.config.bot.name, "Backed Up");
  assert.equal(b.app.config.keys.newsApi, "secretsecret1234");
  assert.deepEqual(cookies.savedSites(b.app.config), ["youtube"]);
});

test("restore asks for confirmation, is owner/private only, and rejects foreign files", async () => {
  const t = realBot();
  const file = Buffer.from(JSON.stringify(backup.create(realBot().app, { version: "x" })));
  const send = async (caption, chat = OWNER_JID, buffer = file) => {
    const msg = docMsg({ caption, chat });
    const original = t.app.commands.byName.get("restore");
    // Feed the document bytes through the normal download path.
    t.app.commands.byName.set("restore", { ...original, run: (ctx) => original.run({ ...ctx, download: async () => buffer }) });
    await t.dispatcher.handleMessage(t.sock, msg);
    t.app.commands.byName.set("restore", original);
  };
  await send(".restore");
  assert.match(t.last(), /To go ahead, reply to the file again with \*\.restore confirm\*/);
  await send(".restore confirm");
  assert.match(t.last(), /Restored \d+ file/);
  await send(".restore confirm", OWNER_JID, Buffer.from('{"hello":"world"}'));
  assert.match(t.last(), /not a backup made with \.backup/);
  await send(".restore confirm", GROUP);
  assert.match(t.last(), /only works in a private chat/);
  const odd = backup.inspect(Buffer.from(JSON.stringify({ format: "whatsapp-bot-backup", files: { "../evil.json": {}, "cookies/../x.txt": "a", "ok.json": {} } })));
  assert.deepEqual(odd.stores.map(([n]) => n), ["ok"], "path tricks are ignored");
  assert.deepEqual(odd.cookieSites, []);
});
