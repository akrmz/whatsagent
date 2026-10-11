"use strict";

const re = require("../services/realestate");
const photohash = require("../services/photohash");
const { show, captureInquiry } = require("../services/listingview");
const { alternatives, offerText } = require("../services/alternatives");
const { limiterFor } = require("../core/ratelimit");
const { allowLookup } = require("../services/lookuplimits");

const MAX_BYTES = 8 * 1024 * 1024;
const WINDOW = 10 * 60 * 1000;
// Per client, and for everyone together (many numbers sending photos don't keep the server decoding).
// The client's own limit first: one number over its limit doesn't use up everyone's.
const lookups = (state, key) =>
  limiterFor(state, "photo-lookup", { max: 5, windowMs: WINDOW })(key) &&
  limiterFor(state, "photo-lookup-all", { max: 60, windowMs: WINDOW, size: 1 })("all");

/**
 * A client sends a photo in a private chat (a unit they saw: forwarded from a group, saved from
 * one of your posts): if it is one of your listings' photos (the fingerprints of 3.65), they get
 * that listing's card, or similar ones if it is gone. No match: nothing is said (you see the photo).
 * After the sellers' intake, which takes an owner's photos of their own home first. 5 photos in
 * 10 minutes per client (60 for everyone) are looked up; the photo isn't kept.
 */
module.exports = {
  name: "photo-lookup",
  event: "message",
  phase: "post",
  priority: 24,
  privateOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner) return undefined;
    const media = ctx.findMedia({ types: ["image"], quoted: false });
    if (!media || media.viewOnce || (media.size && media.size > MAX_BYTES))
      return undefined;
    if (!lookups(ctx.state, ctx.sender)) return undefined;
    let matches;
    try {
      matches = await photohash.sameAs(ctx.state, [
        await ctx.download(media, MAX_BYTES),
      ]);
    } catch (err) {
      ctx.log.warn({ err: err.message }, "photo lookup failed");
      return undefined;
    }
    const listing = matches.map((m) => re.get(ctx.state, m.id)).find(Boolean);
    if (!listing) return undefined;
    // An album of the same unit: one card.
    if (!allowLookup(ctx, `photo:${listing.id}`)) return "stop";
    await ctx.reply(`🔎 الصورة دي من وحدة عندنا: #${listing.id}`);
    await show(ctx, listing);
    const alts =
      listing.status === "available" ? [] : alternatives(ctx.state, listing);
    if (alts.length)
      await ctx.send(offerText(listing, alts, re.agent(ctx.state)));
    await captureInquiry(ctx, listing, { alts });
    return "stop";
  },
};
