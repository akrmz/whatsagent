"use strict";

const cards = require("./cards");
const { at } = require("./targets");

/** Welcome/goodbye messages: text with variables plus a card drawn on the server. */

const DEFAULTS = { welcome: "Welcome {user} to {group}! 🎉", goodbye: "Goodbye {user} 👋" };

function fill(template, { user, meta }) {
  return template
    .replace(/{user}/g, at(user))
    .replace(/{group}/g, meta.subject || "")
    .replace(/{description}/g, meta.desc?.toString() || "")
    .replace(/{count}/g, String(meta.participants?.length || 0));
}

/**
 * Builds the message for one member. Falls back to text only if the card can't be drawn.
 * @param {"welcome"|"goodbye"} kind
 */
async function build(app, sock, { kind, user, meta, template }) {
  const text = fill(template || DEFAULTS[kind], { user, meta });
  const phone = app.identity.toPn(user) || user;
  try {
    const image = await cards.welcomeCard({
      avatar: await cards.avatarOf(sock, user),
      kind,
      // LID-only members have no phone number to show.
      name: phone.endsWith("@s.whatsapp.net") ? `+${phone.split("@")[0]}` : kind === "welcome" ? "New member" : "A member",
      group: meta.subject || "",
      members: meta.participants?.length || 0,
    });
    return { image, caption: text, mentions: [user] };
  } catch {
    return { text, mentions: [user] };
  }
}

module.exports = { build, fill, DEFAULTS };
