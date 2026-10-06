"use strict";

const prayertimes = require("./prayertimes");

/**
 * Prayer-time alerts (.autoprayer): at each of the five prayers the chat gets
 * "حان الآن موعد أذان …" for its city, in the city's own time zone.
 * Stored in DATA_DIR/prayer-alerts.json as { [chat]: { city, done: { Fajr: "2026-10-06" } } }.
 * An alert more than 20 minutes late (the bot was offline) is skipped, not sent late.
 */

const LATE_LIMIT_MIN = 20;
const MAX_CHATS = 300;
const store = (state) => state.store("prayer-alerts", {});

const get = (state, chat) => store(state).data[chat] || null;

function set(state, chat, city) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { city, done: {} };
    return d[chat];
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

/** Prayers due now for one chat. Exported for tests. */
async function dueFor(entry, now = Date.now(), lookup) {
  const p = await prayertimes.forCity(entry.city, now, lookup);
  return prayertimes.PRAYERS.filter((name) => {
    if (entry.done?.[name] === p.day) return false;
    const late = p.minutes - p.times[name];
    return late >= 0 && late <= LATE_LIMIT_MIN;
  }).map((name) => ({ name, day: p.day, at: p.times[name], city: p.city }));
}

/** The next prayer after now, from a prayertimes.forCity() result (tomorrow's Fajr after Isha). */
function nextPrayer(p) {
  const name = prayertimes.PRAYERS.find((n) => p.times[n] > p.minutes) || "Fajr";
  const inMinutes = (p.times[name] - p.minutes + 1440) % 1440;
  return { name, at: p.times[name], inMinutes };
}

const message = ({ name, at, city }) =>
  `🕌 حان الآن موعد أذان *${prayertimes.AR[name]}* (${prayertimes.hhmm(at)}) بتوقيت ${city}\n\n_📿 أذكار الأذان: .hisn 15_`;

async function runDue(app, now = Date.now(), lookup) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    let due;
    try {
      due = await dueFor(entry, now, lookup);
    } catch (err) {
      app.log.warn({ err: err.message }, "prayer times lookup failed");
      continue;
    }
    for (const d of due) {
      s.update(() => {
        entry.done ||= {};
        entry.done[d.name] = d.day;
      });
      try {
        await app.sock.sendMessage(chat, { text: message(d).replace(".hisn", `${app.config.bot.prefix}hisn`) });
        sent++;
      } catch (err) {
        app.log.warn({ err: err.message }, "could not send a prayer alert");
      }
    }
  }
  return sent;
}

/** Marks prayers already passed today as done, so turning it on doesn't announce them late. */
async function skipPassed(state, chat, now = Date.now(), lookup) {
  const entry = get(state, chat);
  if (!entry) return null;
  const p = await prayertimes.forCity(entry.city, now, lookup);
  store(state).update(() => {
    entry.done = {};
    for (const name of prayertimes.PRAYERS) if (p.minutes >= p.times[name]) entry.done[name] = p.day;
  });
  return p;
}

function startAdhanLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "prayer alert loop failed");
    } finally {
      running = false;
    }
  }, 30 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { nextPrayer, get, set, remove, dueFor, runDue, skipPassed, startAdhanLoop, message, MAX_CHATS };
