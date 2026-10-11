"use strict";

const watch = require("../services/watch");

/** A client's "نبهني 12" / "الغاء التنبيه 12" in a private chat (services/watch.js), before the assistant. */
module.exports = {
  name: "watch-listing",
  event: "message",
  phase: "post",
  priority: 20,
  privateOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner) return undefined;
    return (await watch.handle(ctx)) ? "stop" : undefined;
  },
};
