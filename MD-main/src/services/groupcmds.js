"use strict";

/**
 * Commands turned off in one group by its admins (.disable / .enable), and command usage
 * statistics for the owner's .stats. Both are small JSON files in DATA_DIR.
 */

// These can never be turned off, or a group could lock itself out of turning them back on.
const PROTECTED = new Set(["help", "enable", "disable", "disabled"]);

const disabledStore = (state) => state.store("disabled-commands", {});

const disabledIn = (state, chat) => disabledStore(state).data[chat] || [];
const isDisabled = (state, chat, name) => disabledIn(state, chat).includes(name);

function setDisabled(state, chat, names, off) {
  return disabledStore(state).update((d) => {
    const set = new Set(d[chat] || []);
    for (const n of names) {
      if (off) set.add(n);
      else set.delete(n);
    }
    if (set.size) d[chat] = [...set].sort();
    else delete d[chat];
    return d[chat] || [];
  });
}

const statsStore = (state) => state.store("stats", { since: Date.now(), total: 0, commands: {} });

function countCommand(state, name) {
  statsStore(state).update((d) => {
    d.total = (d.total || 0) + 1;
    d.commands[name] = (d.commands[name] || 0) + 1;
  });
}

function resetStats(state) {
  statsStore(state).update((d) => {
    d.since = Date.now();
    d.total = 0;
    d.commands = {};
  });
}

module.exports = { PROTECTED, disabledIn, isDisabled, setDisabled, statsStore, countCommand, resetStats };
