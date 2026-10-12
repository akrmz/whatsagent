"use strict";

const fs = require("node:fs");
const re = require("./realestate");
const leads = require("./leads");
const brandphoto = require("./brandphoto");
const { limiterFor } = require("../core/ratelimit");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * Promises kept: a client who asks for a listing's photos, video or exact location that isn't
 * there yet is told "هبعتهالك أول ما توصل". The bot remembers who asked, tells the agent once a day
 * per listing what is missing, and sends it to them by itself once it is added (10 minutes after
 * it is first seen, so a few photos added one by one go together), within the campaign hours.
 *   DATA_DIR/media-wait.json { items: { "<listing>:<kind>": { listing, kind, chats: { jid: at }, readyAt? } } }
 */

const KINDS = { photos: "الصور", video: "الفيديو", location: "اللوكيشن" };
const KEEP = 14 * 24 * 3600 * 1000; // a request older than 2 weeks is dropped
const SETTLE = 10 * 60 * 1000;
const MAX_CHATS = 30; // per listing and kind
const MAX_ITEMS = 300;
const MAX_PHOTOS = 5; // the first photos, not a whole album
const PER_RUN = 20;

const store = (state) => state.store("media-wait", { items: {} });
const has = (l, kind) => (kind === "photos" ? (l.photos || 0) > 0 : kind === "video" ? (l.videos || 0) > 0 : Boolean(l.geo));
const tellAgent = (state, key) => limiterFor(state, "media-wait-agent", { max: 1, windowMs: 24 * 3600 * 1000 })(key);

/** What the agent is told, once a day per listing and kind. */
const agentText = (l, kind, n, p = ".") =>
  `${kind === "photos" ? "📸" : kind === "video" ? "🎥" : "📍"} ${n > 1 ? `${n} عملاء مستنيين` : "عميل مستني"} ${KINDS[kind]} بتاعة #${l.id} ${l.type || ""}${l.location ? ` — ${l.location}` : ""} (مفيش لسه).\nأول ما تضيفها هتتبعتلهم لوحدها: ${kind === "photos" ? `${p}listing photo ${l.id} (رد على الصورة)` : kind === "video" ? `${p}listing video ${l.id} (رد على الفيديو)` : `${p}listing loc ${l.id} (رد على اللوكيشن أو لينك جوجل ماب)`}`;

/**
 * A client in a private chat asked for what `l` doesn't have yet: remembered (and the agent told).
 * Staff and groups aren't. @returns {boolean} true if it is now awaited for this chat
 */
async function add(ctx, l, kind, now = Date.now()) {
  if (!KINDS[kind] || ctx.isGroup || ctx.isSudoOrOwner || ctx.fromMe || has(l, kind)) return false;
  const key = `${l.id}:${kind}`;
  const item = store(ctx.state).update((d) => {
    if (!d.items[key] && Object.keys(d.items).length >= MAX_ITEMS) return null;
    const it = (d.items[key] ||= { listing: l.id, kind, chats: {} });
    if (!it.chats[ctx.chatId] && Object.keys(it.chats).length >= MAX_CHATS) return { ...it };
    it.chats[ctx.chatId] = now;
    return { ...it, chats: { ...it.chats } };
  });
  if (!item) return false;
  const owner = ctx.config.owners.numbers[0];
  if (owner && tellAgent(ctx.state, key)) {
    await ctx.sock.sendMessage(`${owner}@s.whatsapp.net`, { text: agentText(l, kind, Object.keys(item.chats).length, ctx.prefix) }).catch(() => {});
  }
  return Boolean(item.chats[ctx.chatId]);
}

/** Sends what was asked for to one chat. */
async function deliver(app, l, kind, jid) {
  if (kind === "photos") {
    const files = re.photos(app.config, l).slice(0, MAX_PHOTOS);
    for (const [i, file] of files.entries()) {
      const image = (await brandphoto.forClients(app, l, i + 1)) || fs.readFileSync(file);
      await app.sock.sendMessage(jid, { image, ...(i === 0 ? { caption: `📸 صور #${l.id} اللي طلبتها${(l.photos || 0) > files.length ? `\nباقي الصور: ابعت #${l.id}` : ""}` } : {}) });
    }
    return;
  }
  if (kind === "video") {
    const [file] = require("./listingmedia").videos(app.config, l);
    if (file) await app.sock.sendMessage(jid, { video: fs.readFileSync(file), mimetype: "video/mp4", caption: `🎥 فيديو #${l.id} اللي طلبته` });
    return;
  }
  await app.sock.sendMessage(jid, { text: `📍 لوكيشن #${l.id} اللي طلبته:` });
  await app.sock.sendMessage(jid, { location: { degreesLatitude: l.geo.lat, degreesLongitude: l.geo.lng, name: `#${l.id} ${l.type || "عقار"}${l.location ? ` — ${l.location}` : ""}`.slice(0, 100) } });
}

/**
 * One pass: sends what has arrived (settled for 10 minutes, within the sending hours) to those
 * who asked, at most 20 messages. Dropped: requests older than 2 weeks, listings gone or no
 * longer available, clients who said وقف. @returns {Promise<number>} chats sent to
 */
async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health?.state !== "open") return 0;
  const s = store(app.state);
  const set = require("./campaigns").settings(app.state);
  const { minutes } = zoneNow(app.config.bot.timezone, now);
  const inHours = minutes >= parseClock(set.from) && minutes < parseClock(set.to);
  let sent = 0;
  for (const [key, it] of Object.entries(s.data.items)) {
    const l = re.get(app.state, it.listing);
    const fresh = Object.entries(it.chats).filter(([, at]) => now - at < KEEP);
    if (!l || l.status !== "available" || !fresh.length) {
      s.update((d) => delete d.items[key]);
      continue;
    }
    if (!has(l, it.kind)) continue;
    if (!it.readyAt) {
      s.update((d) => (d.items[key].readyAt = now));
      continue;
    }
    if (now - it.readyAt < SETTLE || !inHours) continue;
    for (const [jid] of fresh) {
      if (sent >= PER_RUN) return sent;
      const lead = leads.byPhone(app.state, jid.split("@")[0]);
      if (!lead?.optedOut) {
        try {
          await deliver(app, l, it.kind, jid);
          sent++;
          if (lead) leads.note(app.state, lead.id, "bot", `اتبعتله ${KINDS[it.kind]} بتاعة #${l.id} اللي كان طالبها`, now);
        } catch (err) {
          app.log.warn({ listing: l.id, kind: it.kind, err: err.message }, "awaited media not sent");
        }
      }
      s.update((d) => d.items[key] && delete d.items[key].chats[jid]);
    }
    s.update((d) => d.items[key] && !Object.keys(d.items[key].chats).length && delete d.items[key]);
  }
  return sent;
}

/** Waiting now, for .autopilot: [{ listing, kind, count }]. */
const waiting = (state) => Object.values(store(state).data.items).map((it) => ({ listing: it.listing, kind: it.kind, count: Object.keys(it.chats).length }));

module.exports = { add, runDue, waiting, agentText, KINDS, SETTLE, KEEP };
