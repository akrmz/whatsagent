"use strict";

const re = require("./realestate");
const img = require("./reimages");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * "Listing of the day" (.autolistings): once a day at a set time, a chat gets the next
 * available listing (optionally only those matching a search, e.g. "شقة التجمع") as a
 * flyer with its details, going round the catalogue. Up to 3 hours late if the bot was offline.
 * Stored in DATA_DIR/listing-posts.json as { [chat]: { time, query, lastId, last } }.
 */

const LATE_LIMIT_MIN = 180;
const RETRY_MS = 10 * 60 * 1000;
const MAX_CHATS = 100;

const store = (state) => state.store("listing-posts", {});
const get = (state, chat) => store(state).data[chat] || null;

function set(state, chat, { time, query = "" }) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { ...(d[chat] || {}), time, query: String(query).slice(0, 80) };
    return d[chat];
  });
}
const remove = (state, chat) => store(state).update((d) => delete d[chat]);
const markPosted = (state, chat, id) => store(state).update((d) => d[chat] && (d[chat].lastId = id));

/** The next available listing after `lastId` that matches the query, going round. */
function next(state, entry) {
  const list = re.search(state, entry.query || "").list.sort((a, b) => a.id - b.id);
  if (!list.length) return null;
  return list.find((l) => l.id > (entry.lastId || 0)) || list[0];
}

function isDue(entry, timeZone, now) {
  const { day, minutes } = zoneNow(timeZone, now);
  const at = parseClock(entry.time);
  if (entry.last === day || minutes < at || minutes > at + LATE_LIMIT_MIN) return false;
  return !(entry.retryAt && now < entry.retryAt);
}

/** The flyer and caption for one listing. */
async function post(app, chat, listing) {
  const agent = re.agent(app.state);
  const [photo] = re.photos(app.config, listing);
  const caption = `🏡 *عقار اليوم*\n\n${re.card(listing, agent)}\n\nللاستفسار أرسل: #${listing.id}`;
  await app.sock.sendMessage(chat, { image: await img.flyer(listing, agent, photo), caption });
}

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    if (!isDue(entry, zone, now)) continue;
    const listing = next(app.state, entry);
    const day = zoneNow(zone, now).day;
    if (!listing) {
      s.update(() => (entry.last = day)); // nothing available today
      continue;
    }
    try {
      await post(app, chat, listing);
      s.update(() => {
        entry.last = day;
        entry.lastId = listing.id;
        delete entry.retryAt;
      });
      sent++;
    } catch (err) {
      s.update(() => (entry.retryAt = now + RETRY_MS));
      app.log.warn({ err: err.message }, "listing of the day failed; retrying in 10 minutes");
    }
  }
  return sent;
}

function startAutoListingsLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "listing of the day loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { get, set, remove, markPosted, next, isDue, post, runDue, startAutoListingsLoop };
