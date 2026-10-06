"use strict";

const crypto = require("node:crypto");
const { at } = require("./targets");

/**
 * New-member check against spam bots (.captcha): someone who joins must send the answer to
 * a small sum within N minutes, or the bot removes them. Their other messages meanwhile are
 * deleted. Members added by an admin are trusted and skip the check.
 * Settings: DATA_DIR/captcha.json. Pending checks live in memory (a restart forgets them).
 */

const MAX_ATTEMPTS = 3;
const settings = (state) => state.store("captcha", {});
const pending = new Map(); // `${group}|${user}` → { answer, attempts, timer }

const get = (state, group) => settings(state).data[group] || null;

function set(state, group, changes) {
  return settings(state).update((d) => {
    d[group] = { enabled: true, minutes: 3, ...(d[group] || {}), ...changes };
    return d[group];
  });
}

const key = (group, user) => `${group}|${user}`;
const isPending = (group, user) => pending.has(key(group, user));

/** Remove a member who didn't answer in time (or failed too often). */
async function expel(sock, log, group, user, reason) {
  pending.delete(key(group, user));
  try {
    await sock.groupParticipantsUpdate(group, [user], "remove");
    await sock.sendMessage(group, { text: `🚫 ${at(user)} ${reason}`, mentions: [user] });
  } catch (err) {
    log.warn({ err: err.message }, "captcha: could not remove the member (is the bot still an admin?)");
  }
}

/** Sends the question to a new member and starts the timer. */
async function challenge({ sock, log }, group, user, minutes) {
  const a = 2 + crypto.randomInt(9);
  const b = 2 + crypto.randomInt(9);
  const timer = setTimeout(() => expel(sock, log, group, user, "لم يُجب عن سؤال التحقق في الوقت فتمت إزالته. (didn't pass the check in time)"), minutes * 60 * 1000);
  timer.unref?.();
  pending.set(key(group, user), { answer: String(a + b), attempts: 0, timer });
  await sock.sendMessage(group, {
    text: `👋 ${at(user)} أهلاً بك! للتأكد أنك لست برنامجاً، اكتب ناتج: *${a} + ${b}* خلال ${minutes === 1 ? "دقيقة واحدة" : minutes === 2 ? "دقيقتين" : `${minutes} دقائق`}.\n(Answer with the number to stay in the group.)`,
    mentions: [user],
  });
}

/**
 * Checks a message from a member with a pending question.
 * @returns {"passed"|"wrong"|"failed"|null} null if no check is pending
 */
function answer(group, user, text) {
  const p = pending.get(key(group, user));
  if (!p) return null;
  const digits = String(text || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).trim();
  if (digits === p.answer) {
    clearTimeout(p.timer);
    pending.delete(key(group, user));
    return "passed";
  }
  p.attempts++;
  return p.attempts >= MAX_ATTEMPTS ? "failed" : "wrong";
}

function cancel(group, user) {
  const p = pending.get(key(group, user));
  if (p) clearTimeout(p.timer);
  pending.delete(key(group, user));
}

module.exports = { get, set, challenge, answer, expel, cancel, isPending, MAX_ATTEMPTS };
