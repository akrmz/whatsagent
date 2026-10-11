"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { loadCommands, loadListeners } = require("../src/core/loader");
const { COMMANDS_DIR, LISTENERS_DIR } = require("../src/main");
const { buildContext } = require("../src/core/context");
const re = require("../src/services/realestate");
const photohash = require("../src/services/photohash");
const lookup = require("../src/listeners/photolookup");
const { makeApp, makeSock, ALL_OFF } = require("./helpers");

const ME = "201011112222@s.whatsapp.net";
const CLIENT = "201099998888@s.whatsapp.net";
const NOW = Date.parse("2026-10-11T12:00:00Z");

/** A "photo": a scene drawn in SVG, different per colours and position. */
const scene = (bg, sun, x) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${bg}"/><circle cx="${x}" cy="300" r="180" fill="${sun}"/><rect x="520" y="80" width="200" height="420" fill="#222"/></svg>`,
    ),
  )
    .jpeg({ quality: 90 })
    .toBuffer();

async function bot(t) {
  let now = NOW;
  t.mock.timers.enable({ apis: ["Date"], now });
  const loaded = loadCommands(COMMANDS_DIR, { capabilities: ALL_OFF });
  const app = makeApp({
    env: { OWNER_NUMBERS: "201011112222", TIMEZONE: "Africa/Cairo" },
    commands: loaded,
    listeners: loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF }),
  });
  const sock = makeSock();
  app.sock = sock;
  app.health.state = "open";
  const s = app.state;
  const villa = re.add(
    s,
    {
      type: "فيلا",
      deal: "بيع",
      location: "الشيخ زايد",
      price: 20e6,
      size: 400,
    },
    ME,
  ).id; // #1
  re.addPhoto(s, app.config, villa, await scene("#88aacc", "#ffcc00", 300));
  re.addPhoto(s, app.config, villa, await scene("#112233", "#ddeeff", 600));
  re.add(
    s,
    {
      type: "فيلا",
      deal: "بيع",
      location: "الشيخ زايد",
      price: 19e6,
      size: 380,
    },
    ME,
  ); // #2, similar
  await photohash.backfill(s, app.config);
  let n = 0;
  /** A photo sent in a chat; the download is the given jpeg (no WhatsApp). */
  const photo = async (jpeg, { from = CLIENT, chat = from } = {}) => {
    const ctx = buildContext(app, sock, {
      key: {
        id: `P${++n}`,
        remoteJid: chat,
        fromMe: false,
        participant: chat === from ? undefined : from,
      },
      pushName: "x",
      message: { imageMessage: { mimetype: "image/jpeg" } },
    });
    ctx.download = async () => jpeg;
    return lookup.run(ctx);
  };
  const later = (ms = 60000) => t.mock.timers.setTime((now += ms));
  const to = (jid) => sock.sent.filter((m) => m.jid === jid);
  return { app, s, villa, photo, later, to };
}

test("a client's photo of one of your units gets that unit's card; an unknown photo gets nothing", async (t) => {
  const b = await bot(t);
  assert.equal(await b.photo(await scene("#112233", "#ddeeff", 600)), "stop");
  const sent = b.to(CLIENT);
  assert.equal(sent[0].content.text, "🔎 الصورة دي من وحدة عندنا: #1");
  assert.ok(
    sent.some((m) => /فيلا/.test(m.content.text || m.content.caption || "")),
    "the card",
  );

  const before = b.to(CLIENT).length;
  b.later();
  assert.equal(
    await b.photo(await scene("#ff0000", "#00ff00", 100)),
    undefined,
    "not ours: the chain goes on",
  );
  assert.equal(b.to(CLIENT).length, before, "and nothing is said");
  t.mock.timers.reset();
});

test("an album of the same unit is one card; 5 photos in 10 minutes are looked up, then quiet", async (t) => {
  const b = await bot(t);
  const jpeg = await scene("#88aacc", "#ffcc00", 300);
  await b.photo(jpeg);
  const after = b.to(CLIENT).length;
  assert.equal(
    await b.photo(jpeg),
    "stop",
    "the second photo of the album is taken, but…",
  );
  assert.equal(b.to(CLIENT).length, after, "…no second card");
  for (let i = 0; i < 3; i++) await b.photo(jpeg); // 5 in all
  assert.equal(await b.photo(jpeg), undefined, "the 6th isn't looked up");
  b.later(11 * 60 * 1000);
  assert.equal(await b.photo(jpeg), "stop", "10 minutes later it is");
  t.mock.timers.reset();
});

test("a sold unit's photo: the card and similar units still available", async (t) => {
  const b = await bot(t);
  re.update(b.s, b.villa, { status: "sold" });
  await b.photo(await scene("#88aacc", "#ffcc00", 300));
  const texts = b
    .to(CLIENT)
    .map((m) => m.content.text || m.content.caption || "");
  assert.ok(
    texts.some((x) => /#2/.test(x)),
    texts.join("\n---\n"),
  );
  t.mock.timers.reset();
});

test("staff and groups: photos aren't looked up; the seller's open offer comes first", async (t) => {
  const b = await bot(t);
  const jpeg = await scene("#88aacc", "#ffcc00", 300);
  assert.equal(
    await b.photo(jpeg, { from: ME }),
    undefined,
    "the owner's photo",
  );
  assert.equal(
    lookup.privateOnly && lookup.publicOnly,
    true,
    "private chats with clients only",
  );
  const chain = loadListeners(LISTENERS_DIR, { capabilities: ALL_OFF })
    .byEvent.get("message:post")
    .map((l) => l.name);
  assert.ok(
    chain.indexOf("seller-intake") < chain.indexOf("photo-lookup"),
    "an owner's photos of their own home go to the offer",
  );
  assert.ok(chain.indexOf("photo-lookup") < chain.indexOf("assistant"));
  assert.equal(b.to(ME).length, 0);
  t.mock.timers.reset();
});
