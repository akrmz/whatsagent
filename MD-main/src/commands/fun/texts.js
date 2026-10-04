"use strict";

const { shizoText } = require("../../services/external");
const { getJson } = require("../../core/http");

function shizo(name, kind, description, aliases = []) {
  return {
    name,
    aliases,
    category: "fun",
    description,
    cooldown: 5,
    externalService: "shizoapi.onrender.com",
    async run(ctx) {
      return ctx.reply(await shizoText(kind));
    },
  };
}

module.exports = [
  shizo("truth", "truth", "Gives a random truth question."),
  shizo("dare", "dare", "Gives a random dare."),
  shizo("flirt", "flirt", "Sends a random flirty line."),
  shizo("shayari", "shayari", "Sends a random shayari (poem).", ["shayri"]),
  shizo("goodnight", "lovenight", "Sends a good-night message.", ["lovenight", "gn"]),
  {
    name: "roseday",
    category: "fun",
    description: "Sends a Rose Day quote.",
    cooldown: 5,
    externalService: "api.princetechn.com",
    async run(ctx) {
      const data = await getJson("https://api.princetechn.com/api/fun/roseday?apikey=prince");
      return ctx.reply(data.result || "🌹");
    },
  },
];
