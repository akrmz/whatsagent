"use strict";

const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");

/**
 * Posts that repeat every N hours in a chat (.autotafsir, .autoazkar dua every N):
 *   tafsir – a random verse with al-Tafsir al-Muyassar
 *   dua    – a random supplication from Hisn al-Muslim
 *   hadith – a random hadith with its grade and explanation (hadeethenc.com)
 * Quiet hours (default 23:00–07:00 in TIMEZONE) hold posts until they end, so groups
 * aren't woken at night. Stored in DATA_DIR/autopost.json as
 *   { [chat]: { quiet: "23:00-07:00" | null, tafsir: { every: 3, next: 1760000000000 }, dua: {…} } }
 */

const KINDS = ["tafsir", "dua", "hadith"];
const MIN_HOURS = 1;
const MAX_HOURS = 24;
const MAX_CHATS = 300;
const DEFAULT_QUIET = "23:00-07:00";
const RETRY_MS = 10 * 60 * 1000;
const MAX_RETRY_MS = 6 * 3600 * 1000;
const MAX_SEND_FAILURES = 12; // about 2 days of failed sends: the bot is no longer in that chat

/** 10 min, 20, 40, 80, 160, 320, then every 6 hours. */
const retryDelay = (failures) => Math.min(RETRY_MS * 2 ** Math.max(0, failures - 1), MAX_RETRY_MS);

const store = (state) => state.store("autopost", {});
const get = (state, chat) => store(state).data[chat] || null;

/** Arabic "every N hours": كل ساعة، كل ساعتين، كل 3 ساعات، كل 12 ساعة. */
const everyHoursAr = (n) => (n === 1 ? "كل ساعة" : n === 2 ? "كل ساعتين" : n <= 10 ? `كل ${n} ساعات` : `كل ${n} ساعة`);

/** "23:00-07:00" → { start, end } in minutes, or null. */
function parseQuiet(text) {
  const m = String(text || "").replace(/\s+/g, "").match(/^(.+?)[-–](.+)$/);
  if (!m) return null;
  const start = parseClock(m[1]);
  const end = parseClock(m[2]);
  return start === null || end === null || start === end ? null : { start, end };
}

/** Minutes until quiet hours end, or 0 when not in quiet hours. */
function quietLeft(quiet, minutes) {
  const q = parseQuiet(quiet);
  if (!q) return 0;
  const inside = q.start < q.end ? minutes >= q.start && minutes < q.end : minutes >= q.start || minutes < q.end;
  return inside ? (q.end - minutes + 1440) % 1440 : 0;
}

/**
 * sentNow: the command already posted the first one, so the next comes after `hours`;
 * otherwise (e.g. it couldn't be fetched) the loop tries in about a minute.
 */
function setEvery(state, chat, kind, hours, now = Date.now(), { sentNow = false } = {}) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] ||= { quiet: DEFAULT_QUIET };
    d[chat][kind] = { every: hours, next: sentNow ? now + hours * 3600 * 1000 : now + 60 * 1000 };
    return d[chat];
  });
}

/** When a job will really post: its next time, pushed to the end of quiet hours if needed. */
function effectiveNext(job, quiet, timeZone, now = Date.now()) {
  const at = Math.max(job.next, now);
  const { minutes } = zoneNow(timeZone, at);
  return at + quietLeft(quiet, minutes) * 60 * 1000;
}

/** "07:00" style local time of a timestamp, and how far away it is. */
function describeNext(next, timeZone, now = Date.now()) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(next));
  const mins = Math.max(0, Math.round((next - now) / 60000));
  const left = mins >= 60 ? `${Math.floor(mins / 60)} س ${mins % 60} د` : `${mins} د`;
  return `${time} (بعد ${left})`;
}

function setQuiet(state, chat, quiet) {
  return store(state).update((d) => {
    d[chat] ||= { quiet: DEFAULT_QUIET };
    d[chat].quiet = quiet;
    return d[chat];
  });
}

function stop(state, chat, kind) {
  return store(state).update((d) => {
    if (!d[chat]?.[kind]) return false;
    delete d[chat][kind];
    if (!KINDS.some((k) => d[chat][k])) delete d[chat];
    return true;
  });
}

/**
 * Sends what is due. builders: { tafsir: async () => text, dua: async () => text }.
 * Failures are retried after 10 minutes, then less and less often (up to every 6 hours).
 * If the content can't be fetched (an API is down) the post keeps retrying; if sending to the
 * chat fails 12 times in a row (the bot was removed), that post is stopped.
 */
async function runDue(app, builders, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const { minutes } = zoneNow(app.config.bot.timezone, now);
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    for (const kind of KINDS) {
      const job = entry[kind];
      if (!job || now < job.next) continue;
      const wait = quietLeft(entry.quiet, minutes);
      if (wait) {
        s.update(() => (job.next = now + wait * 60 * 1000));
        continue;
      }
      let text;
      try {
        text = await builders[kind]();
      } catch (err) {
        const failures = (job.failures || 0) + 1;
        s.update(() => Object.assign(job, { failures, next: now + retryDelay(failures) }));
        app.log.warn({ err: err.message, kind, failures }, "auto post: could not get the content; retrying later");
        continue;
      }
      try {
        await app.sock.sendMessage(chat, { text });
        s.update(() => {
          job.next = now + job.every * 3600 * 1000;
          delete job.failures;
          delete job.sendFailures;
        });
        sent++;
      } catch (err) {
        const sendFailures = (job.sendFailures || 0) + 1;
        if (sendFailures >= MAX_SEND_FAILURES) {
          stop(app.state, chat, kind);
          app.log.warn({ err: err.message, kind, sendFailures }, "auto post stopped: sending to this chat keeps failing");
          continue;
        }
        s.update(() => Object.assign(job, { sendFailures, next: now + retryDelay(sendFailures) }));
        app.log.warn({ err: err.message, kind, sendFailures }, "auto post: sending failed; retrying later");
      }
    }
  }
  return sent;
}

function startAutopostLoop(app, builders) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app, builders);
    } catch (err) {
      app.log.error({ err }, "auto post loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { everyHoursAr, describeNext, effectiveNext, get, setEvery, setQuiet, stop, runDue, startAutopostLoop, retryDelay, MAX_SEND_FAILURES, parseQuiet, quietLeft, MIN_HOURS, MAX_HOURS, DEFAULT_QUIET };
