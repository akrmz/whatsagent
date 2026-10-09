"use strict";

const owners = require("../services/owners");
const ownerReport = require("../services/ownerreport");

/**
 * A listing owner's answer to ".listing ask" (in a private chat): recorded, the agent told.
 * Only numbers with an open question are read, so other private messages pass through. An
 * owner's "وقف التقارير" / "اشتراك التقارير" switches their marketing reports. Works in
 * private mode too: it is the answer to something the bot sent.
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
    const phone = pn.split("@")[0];
    if (await ownerReport.handleWord(ctx, phone)) return "stop";
    return (await owners.handleReply(ctx, phone)) ? "stop" : undefined;
  },
};
