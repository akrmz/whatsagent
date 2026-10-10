"use strict";

const { proto, getBinaryNodeChild } = require("@whiskeysockets/baileys");
const http = require("../core/http");
const { unwrap } = require("../core/media");
const { getText } = require("../core/context");
const drafts = require("./drafts");
const img = require("./reimages");
const { UserError } = require("../core/errors");
const { limiterFor } = require("../core/ratelimit");

/**
 * WhatsApp channels read as listings (.channel): the owner adds a channel by its link, the bot
 * follows it, and each post (text and photos) becomes a draft (.drafts), or a listing straight
 * away with "auto". New posts come in live and, as a fallback, every 10 minutes the latest are
 * fetched; ".channel import" fetches the recent ones once.
 *   DATA_DIR/channels.json { items: { [jid]: { name, by, notify, since, auto?, seen: [ids] } } }
 *
 * Channel media isn't end-to-end encrypted: a post's photo is fetched from WhatsApp's media server
 * by its path. Only that host, at most 15 MB, and it must decode as an image (it is re-encoded).
 */

const MEDIA_HOST = "mmg.whatsapp.net";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_CHANNELS = 10;
const MAX_IMPORT = 50;
const KEEP_SEEN = 300;
const INVITE = /(?:whatsapp\.com\/channel\/)([A-Za-z0-9]{10,60})/i;
const JID = /^\d{6,30}@newsletter$/;

const store = (state) => state.store("channels", { items: {} });
const get = (state, jid) => store(state).data.items[jid] || null;
const list = (state) => Object.entries(store(state).data.items).map(([jid, c]) => ({ jid, ...c }));

let requester = (url, opts) => http.request(url, opts);
/** For tests: what fetches channel media. */
const setRequester = (fn) => (requester = fn || ((url, opts) => http.request(url, opts)));

/**
 * The photo of a channel post, as a JPEG ready to keep. Encrypted media (a mediaKey) goes through
 * Baileys' usual download instead.
 */
async function photoOf(image, download) {
  if (!image) return null;
  if (image.fileLength && Number(image.fileLength) > MAX_BYTES) throw new Error("photo too large");
  let buffer;
  if (image.mediaKey) {
    buffer = await download();
  } else {
    const p = String(image.directPath || "");
    if (!p.startsWith("/") || p.startsWith("//")) throw new Error("no media path");
    const url = new URL(p, `https://${MEDIA_HOST}`);
    if (url.protocol !== "https:" || url.hostname !== MEDIA_HOST) throw new Error("unexpected media host");
    buffer = (await requester(url.toString(), { maxBytes: MAX_BYTES, timeoutMs: 30000 })).body;
  }
  return img.toListingJpeg(buffer); // anything that isn't a picture fails here
}

/** A channel's jid and name from its link ("https://whatsapp.com/channel/0029Va…") or its jid. */
async function resolve(sock, input) {
  const s = String(input || "").trim();
  const code = s.match(INVITE)?.[1];
  if (!code && !JID.test(s)) throw new UserError("Send the channel's link (https://whatsapp.com/channel/…), from the channel's info → Share.");
  const meta = await sock.newsletterMetadata(code ? "invite" : "jid", code || s).catch(() => null);
  if (!meta?.id) throw new UserError("Couldn't find that channel. Check the link (it may have been reset).");
  const name = meta.name || meta.thread_metadata?.name?.text || meta.thread_metadata?.name || "قناة";
  return { jid: meta.id, name: String(name).slice(0, 60), role: meta.viewer_metadata?.role };
}

async function add(state, sock, input, { by, notify, auto = false }, now = Date.now()) {
  const ch = await resolve(sock, input);
  if (!get(state, ch.jid) && list(state).length >= MAX_CHANNELS) throw new UserError(`At most ${MAX_CHANNELS} channels.`);
  // Follow it (an owner or admin of the channel already gets its posts).
  if (!["OWNER", "ADMIN", "SUBSCRIBER"].includes(ch.role)) await sock.newsletterFollow?.(ch.jid).catch(() => {});
  await sock.subscribeNewsletterUpdates?.(ch.jid).catch(() => {});
  store(state).update((d) => (d.items[ch.jid] = { name: ch.name, by, notify, since: now, ...(auto ? { auto: true } : {}), seen: d.items[ch.jid]?.seen || [] }));
  return { ...ch, auto };
}

function remove(state, jid) {
  const c = get(state, jid);
  if (!c) throw new UserError("That channel isn't being read.");
  store(state).update((d) => delete d.items[jid]);
  return c;
}

/** Remembers a post id; false if it was already handled (a live post fetched again). */
function firstTime(state, jid, id) {
  if (!id) return true;
  return store(state).update((d) => {
    const c = d.items[jid];
    if (!c) return false;
    if (c.seen.includes(id)) return false;
    c.seen = [...c.seen, id].slice(-KEEP_SEEN);
    return true;
  });
}

/**
 * One channel post (a Baileys message: { key, message }) into the drafts. Text and photo; other
 * kinds (video, polls …) are left. @returns {Promise<object|null>} collect()'s result
 */
async function intake(app, msg, { download } = {}) {
  const jid = msg.key?.remoteJid;
  const c = jid && get(app.state, jid);
  if (!c) return null;
  if (!firstTime(app.state, jid, msg.key.id)) return null;
  const content = unwrap(msg.message);
  const text = getText(content).trim();
  // B-26: nothing is downloaded for a post that wouldn't be kept, and a channel brings at most
  // POSTS_PER_HOUR posts; the owner hears once in a while that some were left.
  const at = msg.messageTimestamp ? Math.min(Date.now(), Number(msg.messageTimestamp) * 1000) : Date.now();
  const space = drafts.room(app.state, `ch:${jid}`, at);
  const wanted = (content?.imageMessage && space.photo) || (text && space.text);
  if (!wanted || !postBudget(app.state, jid)) {
    if (content?.imageMessage || text) await tellLeft(app, c, jid);
    return null;
  }
  let jpeg = null;
  if (content?.imageMessage && space.photo) {
    try {
      jpeg = await photoOf(content.imageMessage, download || (() => Promise.reject(new Error("no download"))));
    } catch (err) {
      app.log.warn({ err: err.message }, "channel photo not kept");
    }
  }
  if (!text && !jpeg) return null;
  return drafts.collect(
    app.state,
    app.config,
    {
      source: { kind: "channel", key: `ch:${jid}`, name: c.name, notify: c.notify, ...(c.auto ? { auto: true } : {}) },
      text,
      jpeg,
      by: c.by,
      ownerNumber: app.config.owners.numbers[0],
    },
    at,
  );
}

const POSTS_PER_HOUR = 120;
const postBudget = (state, jid) => limiterFor(state, "channel-posts", { max: POSTS_PER_HOUR, windowMs: 3600 * 1000 })(jid);
const leftNote = (state, jid) => limiterFor(state, "channel-left-note", { max: 1, windowMs: 6 * 3600 * 1000 })(jid);

/** Once every 6 hours per channel: posts are being left (the drafts are full, or too many posts). */
async function tellLeft(app, c, jid) {
  if (!c.notify || !app.sock || !leftNote(app.state, jid)) return;
  const p = app.config.bot.prefix;
  await app.sock
    .sendMessage(c.notify, { text: `📥 بوستات من قناة "${c.name}" مش بتتجمع دلوقتي: المسودات المستنية وصلت ${drafts.MAX_OPEN}، أو القناة نزّلت أكتر من ${POSTS_PER_HOUR} بوست في الساعة.\nراجع واحفظ أو امسح: ${p}drafts · ${p}drafts save all · ${p}drafts del all` })
    .catch(() => {});
}

/**
 * The posts in a fetch result (newsletterFetchMessages): every <message> with a <plaintext> child,
 * decoded as Baileys does for live posts, oldest first. Unknown shapes give nothing.
 */
function postsIn(node, jid) {
  const out = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== "object" || depth > 6) return;
    if (n.tag === "message") {
      const plain = getBinaryNodeChild(n, "plaintext");
      if (plain?.content) {
        try {
          const buf = typeof plain.content === "string" ? Buffer.from(plain.content, "binary") : Buffer.from(plain.content);
          out.push({ key: { remoteJid: jid, id: String(n.attrs?.message_id || n.attrs?.server_id || ""), fromMe: false }, message: proto.Message.decode(buf).toJSON(), messageTimestamp: Number(n.attrs?.t) || undefined });
        } catch {
          // not a message we can read
        }
      }
      return;
    }
    if (Array.isArray(n.content)) for (const c of n.content) walk(c, depth + 1);
  };
  walk(node, 0);
  return out.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));
}

/** Fetches a channel's latest posts into the drafts. @returns {Promise<{ posts, collected }>} */
async function fetchRecent(app, jid, count = 10) {
  if (!get(app.state, jid)) throw new UserError("That channel isn't being read.");
  const n = Math.max(1, Math.min(MAX_IMPORT, Number(count) || 10));
  const node = await app.sock.newsletterFetchMessages(jid, n);
  const posts = postsIn(node, jid);
  let collected = 0;
  for (const p of posts) if ((await intake(app, p))?.isNew) collected++; // a photo joining the post before it is the same unit
  return { posts: posts.length, collected };
}

/** Every 10 minutes: renew the live updates and fetch what may have been missed. */
function startChannelsLoop(app) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !app.sock || app.health.state !== "open") return;
    busy = true;
    try {
      for (const { jid } of list(app.state)) {
        await app.sock.subscribeNewsletterUpdates?.(jid).catch(() => {});
        await fetchRecent(app, jid, 10).catch((err) => app.log.warn({ err: err.message }, "channel fetch failed"));
      }
    } finally {
      busy = false;
    }
  }, 10 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { add, remove, get, list, resolve, intake, postsIn, fetchRecent, photoOf, startChannelsLoop, setRequester, MEDIA_HOST, MAX_CHANNELS, MAX_IMPORT };
