"use strict";

const { normalizeJid } = require("../../core/identity");

module.exports = {
  name: "whoami",
  category: "general",
  description: "Shows the IDs WhatsApp uses for you and your permission level. Useful when setting OWNER_LIDS.",
  cooldown: 10,

  async run(ctx) {
    if (ctx.isGroup) await ctx.groupMetadata().catch(() => null); // learn PN↔LID pairs
    const ids = ctx.app.identity.aliases(ctx.sender).map(normalizeJid);
    await ctx.reply(
      [`*Your IDs:*`, ...ids.map((id) => `• ${id}`), "", `*Your level here:* ${ctx.level}`, "", "Owners may put the digits of an @lid ID into OWNER_LIDS."].join("\n"),
    );
  },
};
