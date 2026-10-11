"use strict";

const re = require("../services/realestate");
const places = require("../services/places");
const leads = require("../services/leads");
const viewings = require("../services/viewings");
const { limiterFor } = require("../core/ratelimit");
const { allowLookup } = require("../services/lookuplimits");

const RADIUS_KM = 50;
const SHOW = 5;
const VIEWING_WINDOW = 2 * 24 * 3600 * 1000;

/** A client with a viewing in the last day or the next two: their pin is where they are, for it. */
function aroundAViewing(state, lead, now = Date.now()) {
  if (!lead) return false;
  return viewings.upcoming(state, now).some((v) => v.lead === lead.id && v.at < now + VIEWING_WINDOW);
}

/**
 * A client sends a location pin in a private chat ("أنا ساكن هنا", "عايز حاجة قريبة من هنا"):
 * they get your available units nearest to it (within 50 km, the 5 closest), each with the
 * distance and "#12" for its card. Nothing near: nothing is said.
 * Not looked up: a pin sent as a reply (to a viewing confirmation …), or from a client with a
 * viewing around now (it is where they are). A seller's pin goes to their open offer (sellers'
 * intake, before this). Live locations aren't read.
 */
module.exports = {
  name: "pin-nearby",
  event: "message",
  phase: "post",
  priority: 24,
  privateOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe || ctx.isSudoOrOwner || ctx.quoted) return undefined;
    const raw = ctx.content?.locationMessage;
    const pin = raw && places.fromMessage({ locationMessage: raw });
    if (!pin) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender);
    const lead = leads.byPhone(ctx.state, pn ? pn.split("@")[0] : null);
    if (aroundAViewing(ctx.state, lead)) return undefined;
    if (!limiterFor(ctx.state, "pin-nearby", { max: 5, windowMs: 10 * 60 * 1000 })(ctx.sender)) return "stop";
    if (!allowLookup(ctx, "pin")) return "stop";
    const { list } = re.near(ctx.state, pin, "", { radiusKm: RADIUS_KM });
    if (!list.length) return undefined;
    const cur = re.agent(ctx.state).currency;
    const shown = list.slice(0, SHOW);
    const lines = shown.map(({ listing, km }) => `📍 ${places.km(km)} — ${re.line(listing, cur)}`);
    await ctx.reply(`🗺️ *أقرب وحداتنا المتاحة للموقع ده:*\n\n${lines.join("\n")}\n\nابعت رقم الوحدة زي *#${shown[0].listing.id}* وتوصلك تفاصيلها وصورها.`);
    // The team sees it on the client's card (not the coordinates: where someone lives stays in the chat).
    if (lead && re.agent(ctx.state).autoleads) {
      leads.note(ctx.state, lead.id, ctx.sender, `بعت لوكيشن، وصلته أقرب الوحدات: ${shown.map(({ listing, km }) => `#${listing.id} (${places.km(km)})`).join("، ")}`);
    }
    return "stop";
  },
};
