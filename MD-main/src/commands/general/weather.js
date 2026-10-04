"use strict";

const { getJson, HttpError } = require("../../core/http");

module.exports = {
  name: "weather",
  category: "general",
  description: "Shows the current weather for a city.",
  usage: "<city>",
  examples: [".weather Cairo"],
  cooldown: 10,
  requires: ["openWeather"],
  externalService: "openweathermap.org",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Please specify a city, e.g. ${ctx.prefix}weather London`);
    const qs = new URLSearchParams({ q: ctx.text.slice(0, 80), appid: ctx.config.keys.openWeather, units: "metric" });
    let w;
    try {
      w = await getJson(`https://api.openweathermap.org/data/2.5/weather?${qs}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return ctx.reply("City not found.");
      throw err;
    }
    return ctx.reply(`Weather in ${w.name}: ${w.weather?.[0]?.description}. Temperature: ${w.main?.temp}°C, feels like ${w.main?.feels_like}°C.`);
  },
};
