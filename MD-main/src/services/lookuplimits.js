"use strict";

const { limiterFor } = require("../core/ratelimit");

/**
 * Limits for "#name" note and "#12" listing lookups, which anyone in a chat can trigger:
 * the same item at most once per 30 s in a chat (it's still visible above), and at most
 * 5 lookups per person per minute. Over the limit the bot stays silent (a "please wait"
 * reply would be spam too).
 */

/** Exempt: the owner and sudo users. */
function allowLookup(ctx, item) {
  if (ctx.isSudoOrOwner) return true;
  const sameItem = limiterFor(ctx.state, "lookup-item", { max: 1, windowMs: 30 * 1000 });
  const perPerson = limiterFor(ctx.state, "lookup-person", { max: 5, windowMs: 60 * 1000 });
  return sameItem(`${ctx.chatId}|${item}`) && perPerson(ctx.sender);
}

module.exports = { allowLookup };
