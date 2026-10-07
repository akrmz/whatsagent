"use strict";

const re = require("../services/realestate");
const requests = require("../services/requests");

/**
 * With ".agent requests on": a client's request in a private chat ("عايز شقة في التجمع
 * ميزانية 3 مليون") is answered with the closest listings and saved. Runs after "#12" lookups.
 */
module.exports = {
  name: "client-requests",
  event: "message",
  phase: "post",
  priority: 22,
  publicOnly: true,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !re.agent(ctx.state).requests) return undefined;
    const done = await requests.handle(ctx);
    return done ? "stop" : undefined;
  },
};
