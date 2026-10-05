"use strict";

const { getJson } = require("../core/http");
const { UserError } = require("../core/errors");
const { LRU } = require("../core/lru");

/**
 * Place lookup and weather via Open-Meteo (https://open-meteo.com) — free, no API key.
 * Used by .weather, .time and .prayer.
 */

const cache = new LRU({ max: 500, ttlMs: 24 * 60 * 60 * 1000 });

/** @returns {Promise<{name, country, admin1, latitude, longitude, timezone}>} */
async function geocode(query) {
  const name = String(query || "").trim().slice(0, 80);
  if (!name) throw new UserError("Please give a city name.");
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  // Open-Meteo matches the place name only, so "Cairo, Egypt" is searched as "Cairo"
  // and the rest is used to pick between results with the same name.
  const [place, ...hints] = name.split(",").map((s) => s.trim()).filter(Boolean);
  const qs = new URLSearchParams({ name: place || name, count: "10", language: "en", format: "json" });
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${qs}`, { timeoutMs: 15000 });
  const results = data.results || [];
  const hint = hints.join(" ").toLowerCase();
  const best =
    (hint && results.find((r) => [r.country, r.country_code, r.admin1].some((v) => v && hint.includes(String(v).toLowerCase())))) ||
    results[0];
  if (!best) throw new UserError(`I couldn't find a place called "${name}".`);
  const result = {
    name: best.name,
    country: best.country || best.country_code || "",
    admin1: best.admin1 || "",
    latitude: best.latitude,
    longitude: best.longitude,
    timezone: best.timezone || "UTC",
  };
  cache.set(key, result);
  return result;
}

const label = (p) => [p.name, p.admin1 !== p.name ? p.admin1 : "", p.country].filter(Boolean).join(", ");

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_CODES = {
  0: ["☀️", "Clear sky"],
  1: ["🌤️", "Mainly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Freezing fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌧️", "Heavy drizzle"],
  56: ["🌧️", "Freezing drizzle"],
  57: ["🌧️", "Freezing drizzle"],
  61: ["🌦️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"],
  67: ["🌧️", "Freezing rain"],
  71: ["🌨️", "Light snow"],
  73: ["🌨️", "Snow"],
  75: ["❄️", "Heavy snow"],
  77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Rain showers"],
  81: ["🌧️", "Rain showers"],
  82: ["⛈️", "Violent rain showers"],
  85: ["🌨️", "Snow showers"],
  86: ["❄️", "Heavy snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm with hail"],
  99: ["⛈️", "Thunderstorm with heavy hail"],
};
const describeCode = (code) => WEATHER_CODES[code] || ["🌡️", "Unknown"];

async function forecast(place, days = 3) {
  const qs = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(days),
  });
  return getJson(`https://api.open-meteo.com/v1/forecast?${qs}`, { timeoutMs: 15000 });
}

/** Formats "now" in a time zone, e.g. "Mon 6 Oct 2026, 14:05". */
function formatInZone(date, timeZone, opts = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

/** "+03:00" style offset of a time zone at a given moment. */
function utcOffset(date, timeZone) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  const v = part?.value.replace("GMT", "") || "";
  return v ? `UTC${v}` : "UTC";
}

module.exports = { geocode, forecast, describeCode, label, formatInZone, utcOffset, WEATHER_CODES };
