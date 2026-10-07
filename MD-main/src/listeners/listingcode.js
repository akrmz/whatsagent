"use strict";

const re = require("../services/realestate");
const { show, captureInquiry } = require("../services/listingview");

/**
 * "#12" (the number on a listing's flyer) shows that listing in any chat. Runs after the
 * notes listener, so a note saved as "#12" still wins. In a private chat, with
 * ".agent autoleads on", the person asking is saved as a client and the owner is told.
 */
module.exports = {
  name: "listing-code",
  event: "message",
  phase: "post",
  priority: 21,
  publicOnly: true,
  async run(ctx) {
    const m = re.latinDigits(ctx.body.trim()).match(/^#\s?(\d{1,5})$/);
    if (!m) return undefined;
    const listing = re.get(ctx.state, Number(m[1]));
    if (!listing) return undefined;
    await show(ctx, listing);
    await captureInquiry(ctx, listing);
    return "stop";
  },
};
