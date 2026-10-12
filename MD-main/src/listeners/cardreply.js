"use strict";

const re = require("../services/realestate");
const cardreply = require("../services/cardreply");
const { show, sendVideos, captureInquiry } = require("../services/listingview");
const { alternatives, offerText } = require("../services/alternatives");
const { allowLookup } = require("../services/lookuplimits");
const mediawait = require("../services/mediawait");

/**
 * A client's reply to a listing's card: is it still available, more photos, the video, where it
 * is (services/cardreply.js). Answered without the AI, with the same flood limits as "#12".
 * Anything else goes on (the assistant answers it, knowing which unit is meant).
 */
module.exports = {
  name: "card-reply",
  event: "message",
  phase: "post",
  priority: 18,
  privateOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || !ctx.quoted) return undefined;
    const listing = cardreply.quotedListing(ctx);
    const intent = listing && cardreply.intentOf(ctx.body);
    if (!intent) return undefined;
    if (!allowLookup(ctx, `card-${intent}:${listing.id}`)) return "stop"; // flood: silent
    const a = re.agent(ctx.state);
    if (intent === "video") await sendVideos(ctx, listing);
    else if (intent === "photos") {
      if ((listing.photos || 0) > 1) await show(ctx, listing, { allPhotos: true });
      else if (listing.photos) await ctx.reply(`دي كل صور #${listing.id} 🙏${listing.videos ? `\nوفيه فيديو: ابعت #${listing.id} فيديو` : ""}`);
      // The promise is kept: they get them once they are added (services/mediawait).
      else await ctx.reply((await mediawait.add(ctx, listing, "photos")) ? `مفيش صور لـ #${listing.id} لسه، هبعتهالك أول ما توصل 🙏` : `مفيش صور لـ #${listing.id} لسه 🙏`);
    } else if (intent === "location") {
      if (listing.geo) {
        await ctx.reply({ location: { degreesLatitude: listing.geo.lat, degreesLongitude: listing.geo.lng, name: `#${listing.id} ${listing.type || "عقار"}${listing.location ? ` — ${listing.location}` : ""}`.slice(0, 100) } });
      } else {
        const promised = await mediawait.add(ctx, listing, "location");
        await ctx.reply(`📍 #${listing.id} في ${listing.location || "المنطقة اللي في الإعلان"}.${promised ? " اللوكيشن بالظبط هبعتهولك أول ما يوصل 🙏" : ""}`);
      }
    } else if (listing.status === "available") {
      await ctx.reply(`✅ أيوه، #${listing.id} لسه متاحة.${a.booking ? `\n🗓️ لحجز معاينة ابعت: معاينة ${listing.id}` : ""}`);
    } else {
      const alts = alternatives(ctx.state, listing);
      await ctx.reply(alts.length ? offerText(listing, alts, a) : `للأسف #${listing.id} ${listing.status === "reserved" ? "محجوزة دلوقتي" : "مش متاحة"}. قولي إيه اللي بتدور عليه وأبعتلك أنسب الاختيارات 🙏`);
    }
    await captureInquiry(ctx, listing);
    return "stop";
  },
};
