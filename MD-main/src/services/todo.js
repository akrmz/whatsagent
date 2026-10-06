"use strict";

const { UserError } = require("../core/errors");

/**
 * A shared to-do list per chat (.todo). Stored in DATA_DIR/todo.json as
 *   { [chat]: { seq: 7, items: [{ id, text, by, at, done?, doneBy? }] } }
 * Item numbers stay the same until the item is deleted or cleared.
 */

const MAX_ITEMS = 50;
const MAX_TEXT = 200;
const MAX_CHATS = 500;

const store = (state) => state.store("todo", {});
const list = (state, chat) => store(state).data[chat]?.items || [];

function add(state, chat, user, text, now = Date.now()) {
  const body = String(text || "").trim().replace(/\s+/g, " ");
  if (!body) throw new UserError("Write the task after .todo add");
  if (body.length > MAX_TEXT) throw new UserError(`A task can be at most ${MAX_TEXT} characters.`);
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new UserError("Too many chats have a to-do list on this bot.");
    d[chat] ||= { seq: 0, items: [] };
    if (d[chat].items.length >= MAX_ITEMS) throw new UserError(`The list is full (${MAX_ITEMS}). Clear finished tasks with .todo clear`);
    const item = { id: ++d[chat].seq, text: body, by: user, at: now };
    d[chat].items.push(item);
    return item;
  });
}

function find(d, chat, id) {
  const item = d[chat]?.items.find((x) => x.id === id);
  if (!item) throw new UserError(`There is no task #${id}. See .todo`);
  return item;
}

/** Marks a task done, or not done again. @returns the item */
function toggle(state, chat, user, id) {
  return store(state).update((d) => {
    const item = find(d, chat, id);
    if (item.done) {
      delete item.done;
      delete item.doneBy;
    } else {
      item.done = true;
      item.doneBy = user;
    }
    return item;
  });
}

function remove(state, chat, user, id, { manager = false } = {}) {
  return store(state).update((d) => {
    const item = find(d, chat, id);
    if (item.by !== user && !manager) throw new UserError("Only the person who added it (or an admin) can delete it.");
    d[chat].items = d[chat].items.filter((x) => x !== item);
    if (!d[chat].items.length) delete d[chat];
    return item;
  });
}

/** Removes finished tasks (or all). @returns {number} removed */
function clear(state, chat, { all = false } = {}) {
  return store(state).update((d) => {
    if (!d[chat]) return 0;
    const before = d[chat].items.length;
    d[chat].items = all ? [] : d[chat].items.filter((x) => !x.done);
    const removed = before - d[chat].items.length;
    if (!d[chat].items.length) delete d[chat];
    return removed;
  });
}

const removeChat = (state, chat) => store(state).update((d) => delete d[chat]);

module.exports = { list, add, toggle, remove, clear, removeChat, MAX_ITEMS };
