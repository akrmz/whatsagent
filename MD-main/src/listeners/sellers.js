"use strict";

const re = require("../services/realestate");
const sellers = require("../services/sellers");

/**
 * With ".agent sellers on": an owner who writes that they want to sell or rent out ("عايز أبيع
 * شقتي") is asked for the details and photos, which are collected for the agent (.sellers).
 * Before the client menu, written requests and the assistant, so a seller isn't answered as a buyer.
 */
module.exports = {
  name: "seller-intake",
  event: "message",
  phase: "post",
  priority: 21.3,
  publicOnly: true,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !re.agent(ctx.state).sellers) return undefined;
    return (await sellers.handle(ctx)) ? "stop" : undefined;
  },
};
