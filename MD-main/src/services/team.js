"use strict";

const { zoneNow } = require("./gcschedule");

/**
 * Monthly activity counters per person (.team): clients added, listings/offers/welcomes sent,
 * viewings booked, deals closed and their commission. Kept as counters (not by scanning) because
 * viewings and campaigns are deleted after a while. `by` is whoever did it: a team member, or
 * a client/the bot for automatic actions (the report groups those).
 *   DATA_DIR/team-stats.json { [YYYY-MM]: { [jid]: { leads, sent, viewings, deals, commission } } }
 */

const KEEP_MONTHS = 24;
const KINDS = ["leads", "sent", "viewings", "deals", "commission"];
let timeZone = process.env.TIMEZONE || "UTC";

/** The bot's time zone, so a month starts at local midnight (set at startup). */
const setTimeZone = (tz) => (timeZone = tz || timeZone);
const monthOf = (now) => zoneNow(timeZone, now).day.slice(0, 7);
const store = (state) => state.store("team-stats", {});

function record(state, by, kind, amount = 1, now = Date.now()) {
  if (!by || !KINDS.includes(kind) || !(amount > 0)) return;
  const mk = monthOf(now);
  store(state).update((d) => {
    const m = (d[mk] ||= {});
    const e = (m[by] ||= {});
    e[kind] = (e[kind] || 0) + amount;
    const months = Object.keys(d).sort();
    for (const old of months.slice(0, Math.max(0, months.length - KEEP_MONTHS))) delete d[old];
  });
}

/** One month's counters, { [jid]: { … } }. */
const month = (state, mk) => store(state).data[mk] || {};

module.exports = { record, month, monthOf, setTimeZone, KINDS };
