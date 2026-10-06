"use strict";

const { UserError } = require("../core/errors");

/**
 * Keyword auto-replies per group (.filter): when a message contains the trigger word or
 * phrase, the bot answers with the saved reply. Stored in DATA_DIR/filters.json as
 * { [groupJid]: { [trigger]: { reply, by, at } } }.
 */

const MAX_FILTERS = 50;
const MAX_TRIGGER = 40;
const MAX_REPLY = 1000;

const store = (state) => state.store("filters", {});
const normalize = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function add(state, chat, trigger, reply, by) {
  const key = normalize(trigger);
  if (key.length < 2 || key.length > MAX_TRIGGER) throw new UserError(`The trigger must be 2 to ${MAX_TRIGGER} characters.`);
  if (/^[.!#/]/.test(key)) throw new UserError("A trigger can't start with . ! # or / (those are commands and notes).");
  const text = String(reply || "").trim();
  if (!text) throw new UserError("The reply is empty.");
  if (text.length > MAX_REPLY) throw new UserError(`The reply can be at most ${MAX_REPLY} characters.`);
  return store(state).update((d) => {
    d[chat] ||= {};
    const exists = Boolean(d[chat][key]);
    if (!exists && Object.keys(d[chat]).length >= MAX_FILTERS) throw new UserError(`This group already has ${MAX_FILTERS} auto-replies.`);
    d[chat][key] = { reply: text, by, at: Date.now() };
    return { key, replaced: exists };
  });
}

function remove(state, chat, trigger) {
  return store(state).update((d) => {
    const key = normalize(trigger);
    if (!d[chat]?.[key]) return false;
    delete d[chat][key];
    if (!Object.keys(d[chat]).length) delete d[chat];
    return true;
  });
}

const list = (state, chat) => Object.keys(store(state).data[chat] || {}).sort();

/** The first trigger found in the text as a whole word/phrase (longest triggers win). */
function match(state, chat, text) {
  const filters = store(state).data[chat];
  if (!filters || !text) return null;
  const body = normalize(text);
  const keys = Object.keys(filters).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(key)}($|[^\\p{L}\\p{N}])`, "u");
    if (re.test(body)) return { key, ...filters[key] };
  }
  return null;
}

module.exports = { add, remove, list, match, MAX_FILTERS };
