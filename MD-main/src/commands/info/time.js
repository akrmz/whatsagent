"use strict";

const geo = require("../../services/geo");

module.exports = {
  name: "time",
  aliases: ["clock", "date"],
  category: "info",
  description: "Shows the current date and time in a city (or the bot's time zone).",
  usage: "[city]",
  examples: [".time Tokyo", ".time"],
  cooldown: 5,
  externalService: "open-meteo.com (city lookup)",

  async run(ctx) {
    const now = new Date();
    if (!ctx.text) {
      const zone = ctx.config.bot.timezone;
      return ctx.reply(`🕒 ${geo.formatInZone(now, zone)}\n${zone} (${geo.utcOffset(now, zone)})`);
    }
    const place = await geo.geocode(ctx.text);
    return ctx.reply(`🕒 *${geo.label(place)}*\n${geo.formatInZone(now, place.timezone)}\n${place.timezone} (${geo.utcOffset(now, place.timezone)})`);
  },
};
