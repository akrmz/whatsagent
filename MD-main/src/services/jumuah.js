"use strict";

const path = require("node:path");
const { parseClock } = require("./reminders");
const { zoneNow } = require("./gcschedule");
const azkar = require("./azkar");
const { plain, ar } = require("./khatma");

/**
 * A Friday reminder (.autojumuah): once every Friday at a set time (default 09:00 in
 * TIMEZONE) — the verse of al-Jumu'ah 62:9, reading Surat al-Kahf, sending salawat on the
 * Prophet ﷺ (texts from Hisn al-Muslim) and seeking the hour of response.
 * Stored in DATA_DIR/jumuah.json as { [chat]: { time: "09:00", last: "2026-10-09" } }.
 * If the bot was offline at that time it still sends, up to 3 hours late.
 */

const DEFAULT_TIME = "09:00";
const LATE_LIMIT_MIN = 180;
const RETRY_MS = 10 * 60 * 1000;
const MAX_CHATS = 300;

const store = (state) => state.store("jumuah", {});
const get = (state, chat) => store(state).data[chat] || null;

function set(state, chat, { time = DEFAULT_TIME } = {}) {
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new Error("full");
    d[chat] = { ...(d[chat] || {}), time };
    return d[chat];
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

const isFriday = (timeZone, now) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(now)) === "Fri";

let verse;
function message(prefix = ".") {
  verse ||= require(path.join(__dirname, "..", "..", "assets", "quran-juz-ar.json")).friday;
  const [salawat] = azkar.chapterItems(23); // الصلاة على النبي بعد التشهد (الإبراهيمية)
  const [virtue] = azkar.chapterItems(107); // من صلى علي صلاة صلى الله عليه بها عشراً
  return [
    "🕌 *جمعة مباركة*",
    "",
    `﴿${verse.text}﴾ [${plain(verse.surahName)}: ${ar(verse.ref.split(":")[1])}]`,
    "",
    "📌 *من سنن يوم الجمعة:*",
    `• قراءة سورة الكهف (${prefix}surah 18)`,
    "• الإكثار من الصلاة على النبي ﷺ",
    "• الاغتسال والتطيّب والتبكير إلى الصلاة",
    "• الإكثار من الدعاء وتحرّي ساعة الإجابة",
    "",
    virtue ? `${virtue.text}` : "",
    salawat ? `\n${salawat.text}` : "",
    "",
    "_حصن المسلم · القرآن الكريم_",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

/** Whether the reminder is due now for one chat. Exported for tests. */
function isDue(entry, timeZone, now) {
  if (!isFriday(timeZone, now)) return false;
  const { day, minutes } = zoneNow(timeZone, now);
  const at = parseClock(entry.time || DEFAULT_TIME);
  if (entry.last === day || minutes < at || minutes > at + LATE_LIMIT_MIN) return false;
  return !(entry.retryAt && now < entry.retryAt);
}

/** When the next reminder comes: { day: "2026-10-09", time: "09:00", inMinutes }. */
function nextSend(entry, timeZone, now = Date.now()) {
  const at = parseClock(entry.time || DEFAULT_TIME);
  for (let d = 0; d <= 7; d++) {
    const t = now + d * 86400 * 1000;
    if (!isFriday(timeZone, t)) continue;
    const { day, minutes } = zoneNow(timeZone, t);
    if (d === 0 && (entry.last === day || minutes > at + LATE_LIMIT_MIN)) continue;
    const nowMin = zoneNow(timeZone, now).minutes;
    return { day, time: entry.time || DEFAULT_TIME, inMinutes: Math.max(0, d * 1440 + at - nowMin) };
  }
  return null;
}

async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const s = store(app.state);
  const zone = app.config.bot.timezone;
  let sent = 0;
  for (const [chat, entry] of Object.entries(s.data)) {
    if (!isDue(entry, zone, now)) continue;
    try {
      await app.sock.sendMessage(chat, { text: message(app.config.bot.prefix) });
      s.update(() => {
        entry.last = zoneNow(zone, now).day;
        delete entry.retryAt;
      });
      sent++;
    } catch (err) {
      s.update(() => (entry.retryAt = now + RETRY_MS));
      app.log.warn({ err: err.message }, "Friday reminder failed; retrying in 10 minutes");
    }
  }
  return sent;
}

function startJumuahLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "Friday reminder loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { get, set, remove, message, isDue, nextSend, runDue, startJumuahLoop, DEFAULT_TIME };
