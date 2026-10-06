"use strict";

const cards = require("./cards");
const { at } = require("./targets");
const notes = require("./notes");

/** Welcome/goodbye messages: text with variables plus a card drawn on the server. */

const DEFAULTS = { welcome: "Welcome {user} to {group}! 🎉", goodbye: "Goodbye {user} 👋" };

/** One pass over the template, so "$&" or "{user}" inside a group name or the rules stays as written. */
function fill(template, { user, meta, rules = "" }) {
  const values = {
    user: at(user),
    group: meta.subject || "",
    description: meta.desc?.toString() || "",
    count: String(meta.participants?.length || 0),
    rules,
  };
  return template.replace(/{(user|group|description|count|rules)}/g, (_, k) => values[k]);
}

/**
 * Builds the message for one member. Falls back to text only if the card can't be drawn.
 * @param {"welcome"|"goodbye"} kind
 */
async function build(app, sock, { kind, user, meta, template }) {
  const rules = notes.get(app.state, meta.id, "rules")?.text || "";
  const text = fill(template || DEFAULTS[kind], { user, meta, rules });
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
