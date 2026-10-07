"use strict";

const azkar = require("./azkar");
const adhan = require("./adhan");
const autopost = require("./autopost");
const wird = require("./wird");
const gcschedule = require("./gcschedule");
const reminders = require("./reminders");
const captcha = require("./captcha");
const recap = require("./recap");
const jumuah = require("./jumuah");
const khatma = require("./khatma");
const siyam = require("./siyam");
const hamla = require("./hamla");
const autodl = require("./autodl");
const todo = require("./todo");
const quranquiz = require("./quranquiz");

/**
 * Stops the automatic posts of a chat.
 *   islamic: adhkar, prayer alerts, tafsir/dua/hadith, wird, Friday and fasting reminders (what .autos off stops)
 *   all:     also the group open/close schedule, announcements, captcha, the group khatma, the dhikr campaign, auto-downloads, the to-do list and recap
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
  if (jumuah.get(state, chat)) stopped.push("autojumuah");
  jumuah.remove(state, chat);
  if (siyam.get(state, chat)) stopped.push("autosiyam");
  siyam.remove(state, chat);
  if (all) {
    if (khatma.get(state, chat)) stopped.push("khatma");
    khatma.remove(state, chat);
    if (hamla.get(state, chat)) stopped.push("hamla");
    hamla.remove(state, chat);
    if (autodl.isOn(state, chat)) stopped.push("autodl");
    autodl.set(state, chat, false);
    if (todo.list(state, chat).length) stopped.push("todo");
    todo.removeChat(state, chat);
    quranquiz.removeChat(state, chat);
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
