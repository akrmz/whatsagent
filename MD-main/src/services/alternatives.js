"use strict";

const re = require("./realestate");
const english = require("./english");
const { placeWords } = require("./market");

/**
 * Alternatives to a listing: available units of the same type and deal (a chalet for a chalet,
 * never an apartment), in the same area first, then by how close the price is. Used when a client
 * asks about a unit that is already sold, rented or reserved (an old post), so the conversation
 * goes on instead of ending, and by ".listing similar 12". Only the public catalogue.
 */

const MAX_PRICE_RATIO = 1.4; // at most 40% dearer or cheaper (1 / 1.4) than the unit asked about

function alternatives(state, listing, { max = 3 } = {}) {
  const deal = listing.deal || "بيع";
  const mine = placeWords(listing);
  const scored = re
    .all(state)
    .filter((l) => l.id !== listing.id && l.status === "available" && l.type === listing.type && (l.deal || "بيع") === deal)
    .map((l) => {
      const ratio = listing.price > 0 && l.price > 0 ? l.price / listing.price : null;
      return {
        l,
        ratio,
        sameArea: mine.size > 0 && [...placeWords(l)].some((w) => mine.has(w)),
        priceGap: ratio === null ? 1 : Math.abs(Math.log(ratio)), // without a price: after the close ones
        roomGap: listing.rooms && l.rooms ? Math.abs(listing.rooms - l.rooms) : 1,
      };
    })
    .filter((x) => x.ratio === null || (x.ratio <= MAX_PRICE_RATIO && x.ratio >= 1 / MAX_PRICE_RATIO));
  scored.sort((a, b) => b.sameArea - a.sameArea || a.priceGap - b.priceGap || a.roomGap - b.roomGap || b.l.id - a.l.id);
  return scored.slice(0, max).map((x) => x.l);
}

const GONE_AR = { sold: "اتباع", rented: "اتأجر", reserved: "محجوز حالياً" };
const GONE_EN = { sold: "is sold", rented: "is rented", reserved: "is reserved at the moment" };

/** The message a client gets after the card of a unit that is no longer available. */
function offerText(listing, alts, agent, { lang = "ar" } = {}) {
  if (!alts.length) return null;
  if (lang === "en") {
    const lines = alts.map((l) => {
      const d = english.details(l, agent);
      return `▫️ *#${l.id}* ${d.title}${d.location ? ` — ${d.location}` : ""}${d.priceShort ? ` — ${d.priceShort}` : ""}${l.size ? ` · ${re.group(l.size)} m²` : ""}${l.rooms ? ` · ${l.rooms} bed${l.rooms > 1 ? "s" : ""}` : ""}`;
    });
    return [`🔄 #${listing.id} ${GONE_EN[listing.status] || "is no longer available"}, but here ${alts.length === 1 ? "is a similar one" : "are similar ones"}:`, "", ...lines, "", `Send the number for the details, e.g. #${alts[0].id} en`].join("\n");
  }
  const lines = alts.map((l) => `▫️ ${re.line(l, agent.currency)}`);
  return [`🔄 العقار #${listing.id} ${GONE_AR[listing.status] || "مش متاح دلوقتي"}، بس عندنا ${alts.length === 1 ? "بديل قريب منه" : "بدائل قريبة منه"}:`, "", ...lines, "", `ابعت رقم العقار للتفاصيل، مثلاً #${alts[0].id}`].join("\n");
}

module.exports = { alternatives, offerText, MAX_PRICE_RATIO };
