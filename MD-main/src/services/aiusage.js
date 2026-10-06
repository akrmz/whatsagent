"use strict";

const { LRU } = require("../core/lru");
const { UserError } = require("../core/errors");

/**
 * Daily AI limit per person (AI_DAILY_LIMIT; owner and sudo are exempt) and the short
 * conversation memory of .ai and the chatbot (AI_MEMORY_TURNS). Both live in memory only:
 * conversations are never written to disk, and they are forgotten after 30 minutes idle.
 */

const usage = new LRU({ max: 50000, ttlMs: 36 * 60 * 60 * 1000 });
const memory = new LRU({ max: 5000, ttlMs: 30 * 60 * 1000 });
const MAX_MEMORY_CHARS = 1500;

const day = (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * Counts `cost` requests for the sender, or throws when today's limit is reached.
 * Pictures cost more than text (they are much more expensive for the owner).
 */
function takeQuota(ctx, cost = 1) {
  const limit = ctx.config.ai.dailyLimit;
  if (!limit || ctx.isSudoOrOwner) return;
  const key = `${day(ctx.config.bot.timezone)}|${ctx.sender}`;
  const used = usage.get(key) || 0;
  if (used + cost > limit) {
    throw new UserError(`You have used today's AI limit (${limit}). It resets at midnight (${ctx.config.bot.timezone}).`);
  }
  usage.set(key, used + cost);
}

function remaining(ctx) {
  const limit = ctx.config.ai.dailyLimit;
  if (!limit || ctx.isSudoOrOwner) return Infinity;
  return Math.max(0, limit - (usage.get(`${day(ctx.config.bot.timezone)}|${ctx.sender}`) || 0));
}

/** The remembered exchanges for a conversation, as AI messages. */
function history(key, turns) {
  if (!turns) return [];
  return (memory.get(key) || []).slice(-turns * 2);
}

function remember(key, turns, question, answer) {
  if (!turns) return;
  const cut = (s) => (s.length > MAX_MEMORY_CHARS ? `${s.slice(0, MAX_MEMORY_CHARS)}…` : s);
  const next = [...history(key, turns), { role: "user", content: cut(question) }, { role: "assistant", content: cut(answer) }];
  memory.set(key, next.slice(-turns * 2));
}

const forget = (key) => memory.delete(key);

module.exports = { takeQuota, remaining, history, remember, forget };
