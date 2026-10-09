"use strict";

const re = require("../services/realestate");
const booking = require("../services/selfbooking");

/**
 * With ".agent booking on": clients book a viewing themselves in a private chat ("معاينة",
 * then the number of a time), or cancel it ("الغاء المعاينة"). Runs before the client menu
 * and written requests, so "معاينة 12" isn't read as either.
 */
module.exports = {
  name: "self-booking",
  event: "message",
  phase: "post",
  priority: 21.4,
  publicOnly: true,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !re.agent(ctx.state).booking || !ctx.body) return undefined;
    return (await booking.handle(ctx)) ? "stop" : undefined;
  },
};
