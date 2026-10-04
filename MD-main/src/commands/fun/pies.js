"use strict";

const { getImage } = require("../../services/external");

const COUNTRIES = ["india", "malaysia", "thailand", "china", "indonesia", "japan", "korea", "vietnam"];
const base = { category: "fun", cooldown: 10, externalService: "api.shizo.top (third-party image content)" };

async function send(ctx, country) {
  const image = await getImage(`https://api.shizo.top/pies/${country}?apikey=shizo`);
  return ctx.reply({ image, caption: `pies: ${country}` });
}

module.exports = [
  {
    ...base,
    name: "pies",
    description: `Sends a random picture for a country: ${COUNTRIES.join(", ")}.`,
    usage: "<country>",
    async run(ctx) {
      const country = (ctx.args[0] || "").toLowerCase();
      if (!COUNTRIES.includes(country)) return ctx.reply(`Usage: ${ctx.prefix}pies <country>\nCountries: ${COUNTRIES.join(", ")}`);
      return send(ctx, country);
    },
  },
  ...["china", "indonesia", "japan", "korea", "india", "malaysia", "thailand"].map((country) => ({
    ...base,
    name: country,
    description: `Same as .pies ${country}.`,
    run: (ctx) => send(ctx, country),
  })),
];
