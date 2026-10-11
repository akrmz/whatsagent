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
const LINK_WORDS = 60; // what may come with a Maps link: "قريب من هنا", "ده مكان شغلي"

/** A client with a viewing in the last day or the next two: their pin is where they are, for it. */
function aroundAViewing(state, lead, now = Date.now()) {
  if (!lead) return false;
  return viewings.upcoming(state, now).some((v) => v.lead === lead.id && v.at < now + VIEWING_WINDOW);
}

/**
 * Where the client points to, without opening anything yet: a pin ({ pin }), or a message that
 * is a Google Maps link with a few words at most ({ link }). A longer message with a link in it
 * is about something else. @returns {{ pin } | { link } | null}
 */
function placeIn(ctx) {
  const raw = ctx.content?.locationMessage;
  if (raw) {
    const pin = places.fromMessage({ locationMessage: raw });
    return pin ? { pin } : null;
  }
  const text = re.squeeze(ctx.body || "");
  if (!text || text.length > 600) return null;
  const link = text.match(places.MAP_LINK);
  if (!link) return null;
  const rest = text.replace(places.MAP_LINKS, " ").trim();
  return rest.length <= LINK_WORDS && !/#\s?\d/.test(rest) ? { link: link[0] } : null;
}

/** The point of a Maps link: read from a full link, or a short one opened (shared hourly budget). */
async function linkPoint(state, link) {
  const direct = places.fromText(link);
  if (direct) return direct;
  const short = link.match(places.SHORT);
  if (!short || !places.expandBudget(state)) return null;
  return places.expandShort(short[0]).catch(() => null);
}

/**
 * A client sends a location pin, or a Google Maps link, in a private chat ("أنا ساكن هنا",
 * "عايز حاجة قريبة من هنا"): they get your available units nearest to it (within 50 km, the 5
 * closest), each with the distance and "#12" for its card. Nothing near: nothing is said.
 * Not looked up: a pin or link sent as a reply (to a viewing confirmation …), or from a client
 * with a viewing around now (it is where they are). A seller's pin goes to their open offer
 * (sellers' intake, before this). Live locations aren't read.
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
    const where = placeIn(ctx);
    if (!where) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender);
    const lead = leads.byPhone(ctx.state, pn ? pn.split("@")[0] : null);
    if (aroundAViewing(ctx.state, lead)) return undefined;
    if (!limiterFor(ctx.state, "pin-nearby", { max: 5, windowMs: 10 * 60 * 1000 })(ctx.sender)) return "stop";
    if (!allowLookup(ctx, "pin")) return "stop";
    const pin = where.pin || (await linkPoint(ctx.state, where.link));
    if (!pin) return undefined; // a link that can't be read: left to the rest
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
  placeIn,
};
