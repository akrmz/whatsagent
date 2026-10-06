"use strict";

const ytdlp = require("./ytdlp");

/**
 * Automatic downloads in a group (.autodl on): when someone posts a link to a short video
 * (TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest, YouTube Shorts), the bot
 * replies with the video. Off by default; admins turn it on per group.
 * Limits: one download at a time per group, 15 s between them, 30 per hour per group.
 * Stored in DATA_DIR/autodl.json as { [chat]: { enabled: true } }.
 */

const SITES = new Set(["tiktok", "instagram", "facebook", "twitter", "threads", "snapchat", "pinterest"]);
const COOLDOWN_MS = 15 * 1000;
const PER_HOUR = 30;
const MAX_ITEMS = 4;

const store = (state) => state.store("autodl", {});
const get = (state, chat) => store(state).data[chat] || null;
const isOn = (state, chat) => Boolean(get(state, chat)?.enabled);
const set = (state, chat, enabled) =>
  store(state).update((d) => {
    if (enabled) d[chat] = { enabled: true };
    else delete d[chat];
  });

/** A link the automatic downloader handles, or null. YouTube only for Shorts (long videos stay manual). */
function pickLink(text) {
  const found = ytdlp.detectSite(text);
  if (!found) return null;
  if (SITES.has(found.site)) return found;
  if (found.site === "youtube" && /^\/shorts\/[\w-]{6,20}/.test(new URL(found.url).pathname)) return found;
  return null;
}

const busy = new Set();
const recent = new Map(); // chat → timestamps of the last hour

/** Reserves a slot for a download in this group, or says why not. */
function take(chat, now = Date.now()) {
  if (busy.has(chat)) return "busy";
  const times = (recent.get(chat) || []).filter((t) => now - t < 3600 * 1000);
  if (times.length && now - times.at(-1) < COOLDOWN_MS) return "cooldown";
  if (times.length >= PER_HOUR) return "hourly";
  times.push(now);
  recent.set(chat, times);
  busy.add(chat);
  return null;
}
const release = (chat) => busy.delete(chat);

module.exports = { get, isOn, set, pickLink, take, release, SITES, MAX_ITEMS, PER_HOUR };
