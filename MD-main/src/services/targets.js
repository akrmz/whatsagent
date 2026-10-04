"use strict";

const { normalizeJid } = require("../core/identity");

/**
 * Who a moderation command is about: @mentions first, then the author of the replied
 * message, then phone numbers typed as arguments ("+20 101 234 5678" or "201012345678").
 */
function resolveTargets(ctx, { allowNumbers = true, max = 50 } = {}) {
  let targets = [...ctx.mentions];
  if (!targets.length && ctx.quoted?.sender) targets = [ctx.quoted.sender];
  if (!targets.length && allowNumbers) {
    const digits = ctx.text.replace(/[^\d,\s]/g, " ").split(/[\s,]+/).filter((d) => /^\d{7,15}$/.test(d));
    targets = digits.map((d) => `${d}@s.whatsapp.net`);
  }
  return [...new Set(targets.map(normalizeJid).filter(Boolean))].slice(0, max);
}

/** True if the JID is the bot itself (any of its PN/LID forms). */
function isBot(ctx, jid) {
  const bot = new Set([...ctx.app.identity.aliases(ctx.sock.user?.id), ...ctx.app.identity.aliases(ctx.sock.user?.lid)]);
  return ctx.app.identity.aliases(jid).some((a) => bot.has(a));
}

const at = (jid) => `@${String(jid).split("@")[0].split(":")[0]}`;

module.exports = { resolveTargets, isBot, at };
