"use strict";

const re = require("../services/realestate");
const { show, captureInquiry } = require("../services/listingview");
const { allowLookup } = require("../services/lookuplimits");
const { alternatives, offerText } = require("../services/alternatives");

/**
 * "#12" (the number on a listing's flyer) shows that listing in any chat. Runs after the
 * notes listener, so a note saved as "#12" still wins. In a private chat, with
 * ".agent autoleads on", the person asking is saved as a client and the owner is told. A unit
 * that is sold, rented or reserved (an old post) is followed by up to 3 similar available ones.
 */
module.exports = {
  name: "listing-code",
  event: "message",
  phase: "post",
  priority: 21,
  publicOnly: true,
  async run(ctx) {
    const m = re.latinDigits(ctx.body.trim()).match(/^#\s?(\d{1,5})(?:\s+(en|english))?$/i);
    if (!m) return undefined;
    const listing = re.get(ctx.state, Number(m[1]));
    if (!listing) return undefined;
    if (!allowLookup(ctx, `listing:${listing.id}`)) return "stop"; // flood: silent
    const lang = m[2] ? "en" : "ar";
    await show(ctx, listing, { lang });
    const alts = listing.status === "available" ? [] : alternatives(ctx.state, listing);
    if (alts.length) await ctx.send(offerText(listing, alts, re.agent(ctx.state), { lang }));
    await captureInquiry(ctx, listing, { alts });
    return "stop";
  },
};
