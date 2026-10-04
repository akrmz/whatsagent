"use strict";

module.exports = {
  name: "owner",
  category: "general",
  description: "Sends the bot owner's contact card.",
  cooldown: 10,

  async run(ctx) {
    const number = ctx.config.owners.numbers[0];
    const name = ctx.config.bot.ownerName.replace(/[\r\n;]/g, " ");
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", `FN:${name}`, `TEL;type=CELL;waid=${number}:+${number}`, "END:VCARD"].join("\n");
    await ctx.send({ contacts: { displayName: name, contacts: [{ vcard }] } });
  },
};
