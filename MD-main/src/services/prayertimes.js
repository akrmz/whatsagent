"use strict";

const { getJson } = require("../core/http");
const { geocode } = require("./geo");
const { LRU } = require("../core/lru");

/**
 * Prayer times for a city, in that city's own time zone (aladhan.com picks the calculation
 * method used in the region). Used by .prayer-style features that run on a schedule:
 * .autoprayer and .autoazkar city. Cached per city and day.
 */

const PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const AR = { Imsak: "الإمساك", Fajr: "الفجر", Sunrise: "الشروق", Dhuhr: "الظهر", Asr: "العصر", Maghrib: "المغرب", Isha: "العشاء" };
const cache = new LRU({ max: 1000, ttlMs: 26 * 60 * 60 * 1000 });

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

/** Local date and minutes after midnight in a time zone. */
function localNow(timeZone, now = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * @returns {Promise<{ city, zone, day, minutes: number, times: Record<string, number>, method: string }>}
 *   zone: the city's time zone; day/minutes: the city's local date and time now;
 *   times: Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha in minutes after local midnight
 */
async function forCity(city, now = Date.now(), lookup = { geocode, getJson }) {
  const place = await lookup.geocode(city);
  const local = localNow(place.timezone, now);
  const key = `${place.latitude},${place.longitude}|${local.day}`;
  let entry = cache.get(key);
  if (!entry) {
    const [y, m, d] = local.day.split("-");
    const qs = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude) });
    const res = await lookup.getJson(`https://api.aladhan.com/v1/timings/${d}-${m}-${y}?${qs}`, { timeoutMs: 15000 });
    const t = res.data?.timings;
    if (!t?.Fajr) throw new Error("no prayer times returned");
    entry = {
      times: Object.fromEntries(["Imsak", "Fajr", "Sunrise", ...PRAYERS.slice(1)].filter((k) => t[k]).map((k) => [k, toMinutes(t[k])])),
      method: res.data.meta?.method?.name || "",
    };
    cache.set(key, entry);
  }
  return { city: place.name, zone: place.timezone, ...local, ...entry };
}

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

module.exports = { forCity, localNow, PRAYERS, AR, hhmm, toMinutes };
