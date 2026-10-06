"use strict";

/**
 * Best-guess time zone from an international phone number, for countries with a single
 * time zone. Used only when TIMEZONE is not set and the server runs on UTC (typical for a
 * VPS), so that "06:30" means 06:30 for the owner rather than 06:30 UTC.
 * Countries spanning several zones (US, Canada, Russia, Brazil, Australia, Mexico …) are
 * not guessed.
 */
const ZONES = {
  20: "Africa/Cairo",
  966: "Asia/Riyadh",
  971: "Asia/Dubai",
  965: "Asia/Kuwait",
  974: "Asia/Qatar",
  973: "Asia/Bahrain",
  968: "Asia/Muscat",
  962: "Asia/Amman",
  961: "Asia/Beirut",
  963: "Asia/Damascus",
  964: "Asia/Baghdad",
  970: "Asia/Gaza",
  967: "Asia/Aden",
  212: "Africa/Casablanca",
  213: "Africa/Algiers",
  216: "Africa/Tunis",
  218: "Africa/Tripoli",
  249: "Africa/Khartoum",
  222: "Africa/Nouakchott",
  252: "Africa/Mogadishu",
  253: "Africa/Djibouti",
  90: "Europe/Istanbul",
  92: "Asia/Karachi",
  91: "Asia/Kolkata",
  880: "Asia/Dhaka",
  98: "Asia/Tehran",
  93: "Asia/Kabul",
  60: "Asia/Kuala_Lumpur",
  65: "Asia/Singapore",
  234: "Africa/Lagos",
  254: "Africa/Nairobi",
  27: "Africa/Johannesburg",
  44: "Europe/London",
  353: "Europe/Dublin",
  33: "Europe/Paris",
  49: "Europe/Berlin",
  39: "Europe/Rome",
  34: "Europe/Madrid",
  31: "Europe/Amsterdam",
  32: "Europe/Brussels",
  41: "Europe/Zurich",
  43: "Europe/Vienna",
  46: "Europe/Stockholm",
  47: "Europe/Oslo",
  45: "Europe/Copenhagen",
  48: "Europe/Warsaw",
  30: "Europe/Athens",
  81: "Asia/Tokyo",
  82: "Asia/Seoul",
  86: "Asia/Shanghai",
  63: "Asia/Manila",
  66: "Asia/Bangkok",
  84: "Asia/Ho_Chi_Minh",
};

/** "201012345678" → "Africa/Cairo" (longest matching country code), or null. */
function zoneForNumber(number) {
  const digits = String(number || "").replace(/\D/g, "");
  for (const len of [3, 2, 1]) {
    const zone = ZONES[digits.slice(0, len)];
    if (zone) return zone;
  }
  return null;
}

module.exports = { zoneForNumber };
