"use strict";

const feed = require("../services/feed");

/**
 * In a group watched with ".watch on", brokers' offers and requests are saved to the feed, and
 * the owner is told when one matches their clients or listings. Passive: never replies in the
 * group, never stops other listeners. The bot's own and the owner's/sudo users' posts are skipped.
 */
module.exports = {
  name: "broker-feed",
  event: "message",
  phase: "post",
  priority: 23,
  groupOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !feed.watched(ctx.state, ctx.chatId)) return undefined;
    const found = feed.classify(ctx.body);
    if (!found) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender);
    const item = feed.save(ctx.state, { ...found, chat: ctx.chatId, poster: pn ? pn.split("@")[0] : "", name: ctx.senderName, text: ctx.body });
    if (!item) return undefined; // a repost
    const owner = ctx.config.owners.numbers[0];
    const alert = owner && feed.alertText(ctx.state, item, ctx.prefix);
    if (alert && feed.alertBudget(ctx.state)) await ctx.sock.sendMessage(`${owner}@s.whatsapp.net`, { text: alert }).catch(() => {});
    return undefined;
  },
};
