"use strict";

/**
 * A message to send once the bot is connected again after a restart, e.g. "✅ Now running
 * v2.6.0" after .update now or .restart. Stored in DATA_DIR/pending-notice.json.
 */

const store = (state) => state.store("pending-notice", {});

function setPending(state, { chat, kind, fromVersion }) {
  store(state).update((d) => {
    d.chat = chat;
    d.kind = kind;
    d.fromVersion = fromVersion;
    d.at = Date.now();
  });
  store(state).flush(); // the process is about to exit
}

/** Sends the pending notice if there is one (and it is not stale). Returns true if sent. */
async function deliverPending(app, version, now = Date.now()) {
  const s = store(app.state);
  const p = { ...s.data }; // a copy: the stored object is cleared below
  if (!p.chat || !app.sock || app.health.state !== "open") return false;
  s.update((d) => {
    for (const k of Object.keys(d)) delete d[k];
  });
  if (now - (p.at || 0) > 30 * 60 * 1000) return false; // older than 30 min: skip
  const text =
    p.kind === "update"
      ? `✅ Update finished: now running v${version}${p.fromVersion && p.fromVersion !== version ? ` (was v${p.fromVersion})` : ""}.`
      : `✅ Restarted. Running v${version}.`;
  await app.sock.sendMessage(p.chat, { text }).catch((err) => app.log.warn({ err: err.message }, "could not send the restart notice"));
  return true;
}

/** Checks every 10 s for the first minutes after startup. */
function startNoticeLoop(app, version) {
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    if ((await deliverPending(app, version).catch(() => false)) || tries > 60) clearInterval(timer);
  }, 10 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { setPending, deliverPending, startNoticeLoop };
