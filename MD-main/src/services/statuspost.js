"use strict";

const re = require("./realestate");
const leads = require("./leads");
const img = require("./reimages");

/**
 * Posting a listing to the bot's WhatsApp Status (.statuspost). A status is encrypted to the
 * people listed in `statusJidList` (Baileys: sendMessage("status@broadcast", …, { statusJidList })),
 * and WhatsApp shows it only to those who have the number saved. The audience: saved clients
 * with a number who haven't sent "وقف" (the most recently active first, at most 1,000), and the
 * owner, so it shows on their phone too.
 */

const STATUS_JID = "status@broadcast";
const MAX_AUDIENCE = 1000;

function audience(state, ownerNumbers = []) {
  const clients = leads
    .all(state) // most recently updated first
    .filter((l) => l.phone && !l.optedOut)
    .slice(0, MAX_AUDIENCE)
    .map((l) => `${l.phone}@s.whatsapp.net`);
  return [...new Set([...ownerNumbers.map((n) => `${n}@s.whatsapp.net`), ...clients])];
}

/** A short caption: the story design already shows the details. */
function caption(listing, agent) {
  const cur = agent.currency || "جنيه";
  return [`🏡 ${listing.type || "عقار"} لل${listing.deal || "بيع"}${listing.location ? ` — ${listing.location}` : ""}`, listing.price ? `💰 ${re.money(listing.price, cur)}${listing.deal === "إيجار" ? " شهرياً" : ""}` : null, `للاستفسار أرسل: #${listing.id}`]
    .filter(Boolean)
    .join("\n");
}

/** Posts the listing's 9:16 design to the status. @returns {number} how many saved contacts it was sent to */
async function post(app, listing) {
  const agent = re.agent(app.state);
  const list = audience(app.state, app.config.owners.numbers);
  if (list.length <= app.config.owners.numbers.length) throw new Error("no saved clients with a number to show the status to");
  const [photo] = re.photos(app.config, listing);
  await app.sock.sendMessage(STATUS_JID, { image: await img.story(listing, agent, photo), caption: caption(listing, agent) }, { statusJidList: list });
  re.count(app.state, listing.id, "posted");
  return list.length - app.config.owners.numbers.length;
}

module.exports = { audience, caption, post, STATUS_JID, MAX_AUDIENCE };
