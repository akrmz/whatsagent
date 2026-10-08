"use strict";

const owners = require("../services/owners");

/**
 * A listing owner's answer to ".listing ask" (in a private chat): recorded, the agent told.
 * Only numbers with an open question are read, so other private messages pass through. Works in
 * private mode too: it is the answer to a question the bot asked.
 */
module.exports = {
  name: "owner-reply",
  event: "message",
  phase: "post",
  priority: 13,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !ctx.body) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender);
    if (!pn) return undefined;
    return (await owners.handleReply(ctx, pn.split("@")[0])) ? "stop" : undefined;
  },
};
