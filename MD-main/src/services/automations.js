"use strict";

const azkar = require("./azkar");
const adhan = require("./adhan");
const autopost = require("./autopost");
const wird = require("./wird");
const gcschedule = require("./gcschedule");
const reminders = require("./reminders");
const captcha = require("./captcha");
const recap = require("./recap");

/**
 * Stops the automatic posts of a chat.
 *   islamic: adhkar, prayer alerts, tafsir/dua/hadith, wird (what .autos off stops)
 *   all:     also the group open/close schedule, announcements, captcha and recap
 *            memory (used when the bot leaves or is removed from a group)
 * @returns {string[]} what was running and is now stopped
 */
function stopAll(state, chat, { all = false } = {}) {
  const stopped = [];
  if (azkar.getAuto(state, chat)) stopped.push("autoazkar");
  azkar.removeAuto(state, chat);
  if (adhan.get(state, chat)) stopped.push("autoprayer");
  adhan.remove(state, chat);
  for (const kind of ["tafsir", "dua", "hadith"]) if (autopost.stop(state, chat, kind)) stopped.push(`auto${kind}`);
  if (wird.get(state, chat)) stopped.push("autowird");
  wird.remove(state, chat);
  if (all) {
    if (gcschedule.get(state, chat)) stopped.push("gcschedule");
    gcschedule.clear(state, chat);
    for (const a of reminders.announcementsIn(state, chat)) {
      reminders.removeAnnouncement(state, chat, a.id);
      stopped.push(`announce #${a.id}`);
    }
    if (captcha.get(state, chat)?.enabled) stopped.push("captcha");
    if (captcha.get(state, chat)) captcha.set(state, chat, { enabled: false });
    captcha.cancelGroup(chat);
    recap.clear(chat);
  }
  return stopped;
}

module.exports = { stopAll };
