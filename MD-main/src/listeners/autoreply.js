"use strict";

const autoreply = require("../services/autoreply");

/**
 * .awaymsg / .greet: answers private messages from other people (not the owner or sudo users,
 * not groups). Runs late among the listeners for non-command messages, so a message already
 * answered (e.g. "#12" shows the listing) doesn't also get an automatic reply.
 */
module.exports = {
  name: "autoreply",
  event: "message",
  phase: "post",
  priority: 95,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !ctx.body) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender) || ctx.sender;
    const text = autoreply.replyFor(ctx.state, pn, ctx.config.bot.timezone);
    if (text) await ctx.send(text);
    return undefined;
  },
};
