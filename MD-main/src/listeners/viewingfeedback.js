"use strict";

const feedback = require("../services/viewingfeedback");

/** A client's answer to "إيه رأيك في الوحدة اللي عاينتها؟" (.agent feedback on), before the assistant. */
module.exports = {
  name: "viewing-feedback",
  event: "message",
  phase: "post",
  priority: 19,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !ctx.body) return undefined;
    const r = await feedback.handle(ctx);
    return r === "stop" ? "stop" : undefined;
  },
};
