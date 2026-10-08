"use strict";

const leads = require("../services/leads");

/**
 * Notes when a saved client writes to the bot in a private chat (for "who replied" and "who
 * went quiet" in the morning summary, the client card and .restats). Passive: never replies,
 * never stops other listeners, and works in private mode too.
 */
module.exports = {
  name: "client-activity",
  event: "message",
  phase: "pre",
  priority: 4,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner) return undefined;
    if (leads.optWord(ctx.body)) return undefined; // "وقف" / "اشتراك" aren't replies
    const pn = ctx.app.identity.toPn(ctx.sender);
    const phone = pn ? pn.split("@")[0] : null;
    const lead = leads.byPhone(ctx.state, phone);
    if (lead) leads.seen(ctx.state, lead.id);
    return undefined;
  },
};
