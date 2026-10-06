"use strict";

const { LRU } = require("../core/lru");

/**
 * Recent group conversation as plain text, for .recap ("what did I miss?").
 * Memory only (never written to disk, gone after a restart): the last 200 text messages
 * per group, each cut to 500 characters, for at most 300 groups. Commands are not kept.
 */

const PER_GROUP = 200;
const MAX_TEXT = 500;
const groups = new LRU({ max: 300 });

function record(chat, { name, text, at = Date.now() }) {
  const body = String(text || "").trim();
  if (!body) return;
  let list = groups.get(chat);
  if (!list) {
    list = [];
    groups.set(chat, list);
  }
  list.push({ name: String(name || "?").slice(0, 40), text: body.slice(0, MAX_TEXT), at });
  if (list.length > PER_GROUP) list.splice(0, list.length - PER_GROUP);
}

/** The last `n` messages as a transcript "[14:05] Ali: text". */
function transcript(chat, n, timeZone) {
  const list = (groups.get(chat) || []).slice(-n);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return { count: list.length, text: list.map((m) => `[${fmt.format(new Date(m.at))}] ${m.name}: ${m.text}`).join("\n"), since: list[0]?.at || null };
}

const clear = (chat) => groups.delete(chat);

module.exports = { record, transcript, clear, PER_GROUP };
