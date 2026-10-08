"use strict";

const leads = require("./leads");
const viewings = require("./viewings");

/**
 * Which clients to call first (.leads hot): a score from the pipeline stage, a viewing coming
 * up, a recent message from them, a follow-up due, listings that fit their budget, and
 * minus points for going quiet. Each point comes with a reason the agent can read.
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const STAGE = { new: 10, contacted: 15, viewing: 30, negotiating: 40 };

const since = (ms) => (ms < HOUR ? "منذ دقائق" : ms < DAY ? `منذ ${Math.floor(ms / HOUR)} ساعة` : `منذ ${Math.floor(ms / DAY)} يوم`);
const until = (ms) => (ms < DAY ? `خلال ${Math.max(1, Math.round(ms / HOUR))} ساعة` : `خلال ${Math.round(ms / DAY)} يوم`);

/** @returns {{ lead, score, reasons: string[] } | null} null for closed or opted-out clients */
function score(state, lead, now = Date.now()) {
  if (!(lead.status in STAGE) || lead.optedOut) return null;
  let pts = STAGE[lead.status];
  const reasons = [leads.STATUS[lead.status].ar];
  const add = (n, why) => {
    pts += n;
    reasons.push(why);
  };

  const next = viewings.upcoming(state, now).find((v) => v.lead === lead.id && v.at > now && v.at - now < 7 * DAY);
  if (next) add(25, `👀 معاينة ${until(next.at - now)}`);
  if (lead.lastMsgAt) {
    const ago = now - lead.lastMsgAt;
    if (ago < 2 * DAY) add(20, `💬 راسلك ${since(ago)}`);
    else if (ago < 7 * DAY) add(10, `💬 راسلك ${since(ago)}`);
  }
  if (lead.followUp && lead.followUp.at < now + DAY) add(10, lead.followUp.at < now ? "⏰ متابعة متأخرة" : "⏰ متابعة اليوم");
  const fits = leads.matchingListings(state, lead).filter((m) => !m.fit.over).length;
  if (fits) add(Math.min(fits, 3) * 5, `🏠 ${fits} عقار في ميزانيته`);
  if (lead.max) add(5, "💰 ميزانية معروفة");
  if (leads.awaitingReply(lead) && now - lead.lastSentAt > 3 * DAY) add(-10, `📭 لم يرد منذ ${Math.floor((now - lead.lastSentAt) / DAY)} يوم`);
  if (now - lead.updated > 14 * DAY) add(-15, `💤 بدون تواصل ${Math.floor((now - lead.updated) / DAY)} يوم`);
  return { lead, score: pts, reasons };
}

/** The best clients to work on now, highest score first. */
const hot = (state, n = 10, now = Date.now()) =>
  leads
    .all(state)
    .map((l) => score(state, l, now))
    .filter((x) => x && x.score > 0)
    .sort((a, b) => b.score - a.score || b.lead.updated - a.lead.updated)
    .slice(0, n);

const line = (h, cur) => `🔥 ${h.score} — ${leads.line(h.lead, cur)}\n    ${h.reasons.slice(1).join(" · ") || h.reasons[0]}`;

module.exports = { score, hot, line, STAGE };
