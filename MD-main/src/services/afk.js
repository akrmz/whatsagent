"use strict";

/** AFK status per user, stored in DATA_DIR/afk.json as { [jid]: { reason, since } }. */

const MAX_REASON = 200;

const store = (state) => state.store("afk", {});

/** Every id a user is known by (phone-number JID and LID), so either form matches. */
const idsOf = (app, jid) => (jid ? app.identity.aliases(jid) : []);

function get(app, jid) {
  const data = store(app.state).data;
  for (const id of idsOf(app, jid)) if (data[id]) return { jid: id, ...data[id] };
  return null;
}

function set(app, jid, reason, now = Date.now()) {
  store(app.state).update((d) => {
    d[jid] = { reason: String(reason || "").trim().slice(0, MAX_REASON), since: now };
  });
}

function clear(app, jid) {
  return store(app.state).update((d) => {
    let removed = null;
    for (const id of idsOf(app, jid)) {
      if (d[id]) {
        removed ||= d[id];
        delete d[id];
      }
    }
    return removed;
  });
}

module.exports = { get, set, clear };
