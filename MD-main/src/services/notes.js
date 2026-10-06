"use strict";

const { UserError } = require("../core/errors");

/** Saved notes per chat (DATA_DIR/notes.json): { [chatId]: { [name]: { text, by, at } } }. */

const MAX_NOTES = 100;
const MAX_TEXT = 4000;
const NAME_RE = /^[\p{L}\p{N}_-]{1,30}$/u;

const store = (state) => state.store("notes", {});
const normalize = (name) => String(name || "").replace(/^#/, "").toLowerCase();

function save(state, chat, name, text, by) {
  const key = normalize(name);
  if (!NAME_RE.test(key)) throw new UserError("A note name is one word (letters, digits, - or _), up to 30 characters.");
  const body = String(text || "").trim();
  if (!body) throw new UserError("The note is empty.");
  if (body.length > MAX_TEXT) throw new UserError(`A note can be at most ${MAX_TEXT} characters.`);
  return store(state).update((d) => {
    d[chat] ||= {};
    const exists = Boolean(d[chat][key]);
    if (!exists && Object.keys(d[chat]).length >= MAX_NOTES) throw new UserError(`This chat already has ${MAX_NOTES} notes. Delete some first.`);
    d[chat][key] = { text: body, by, at: Date.now() };
    return { key, replaced: exists };
  });
}

const get = (state, chat, name) => store(state).data[chat]?.[normalize(name)] || null;
const list = (state, chat) => Object.keys(store(state).data[chat] || {}).sort();

function remove(state, chat, name) {
  return store(state).update((d) => {
    const key = normalize(name);
    if (!d[chat]?.[key]) return false;
    delete d[chat][key];
    if (!Object.keys(d[chat]).length) delete d[chat];
    return true;
  });
}

module.exports = { save, get, list, remove, normalize, NAME_RE };
