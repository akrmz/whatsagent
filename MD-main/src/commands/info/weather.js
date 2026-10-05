"use strict";

const geo = require("../../services/geo");

const round = (n) => (Number.isFinite(n) ? Math.round(n) : "?");

module.exports = {
  name: "weather",
  aliases: ["forecast"],
  category: "info",
  description: "Shows the current weather and a 3-day forecast for a city (no API key needed).",
  usage: "<city>",
  examples: [".weather Cairo", ".weather Alexandria, Egypt"],
  cooldown: 10,
  externalService: "open-meteo.com",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Please specify a city, e.g. ${ctx.prefix}weather London`);
    const place = await geo.geocode(ctx.text);
    const w = await geo.forecast(place, 3);
    const c = w.current || {};
    const [icon, sky] = geo.describeCode(c.weather_code);
    const u = w.current_units || {};
    const lines = [
      `${icon} *Weather in ${geo.label(place)}*`,
      `${sky}, ${round(c.temperature_2m)}°C (feels like ${round(c.apparent_temperature)}°C)`,
      `💧 Humidity ${round(c.relative_humidity_2m)}%   💨 Wind ${round(c.wind_speed_10m)} ${u.wind_speed_10m || "km/h"}`,
    ];
    const d = w.daily;
    if (d?.time?.length) {
      lines.push("", "*Next days*");
      d.time.forEach((day, i) => {
        const [dIcon] = geo.describeCode(d.weather_code?.[i]);
        const name = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
        const rain = d.precipitation_probability_max?.[i];
        lines.push(`${dIcon} ${name}: ${round(d.temperature_2m_min?.[i])}° – ${round(d.temperature_2m_max?.[i])}°C${Number.isFinite(rain) ? ` · 🌧️ ${rain}%` : ""}`);
      });
    }
    return ctx.reply(lines.join("\n"));
  },
};
