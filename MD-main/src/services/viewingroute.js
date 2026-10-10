"use strict";

const re = require("./realestate");
const leads = require("./leads");
const viewings = require("./viewings");
const places = require("./places");
const { zoneNow } = require("./gcschedule");

/**
 * A day of viewings (.viewings today / tomorrow, and the morning summary): the viewings in time
 * order, how far each listing is from the one before, a warning when the time between two isn't
 * enough to drive it, and one Google Maps link with every stop in order. Distances are straight
 * lines from the listings' pins; the drive is estimated from them, so it is a warning, not a plan.
 */

const ROAD_FACTOR = 1.3; // roads are longer than the straight line
const CITY_KMH = 30; // a Cairo average, traffic included
const MAX_STOPS = 10; // Google Maps takes the destination and up to 9 stops on the way

/** The minutes a drive of this straight-line distance takes, roughly. */
const driveMinutes = (km) => Math.round(((km * ROAD_FACTOR) / CITY_KMH) * 60);

/** A Google Maps directions link through the points in order, from where you are. */
function routeUrl(points) {
  const at = (p) => `${p.lat},${p.lng}`;
  const stops = points.slice(0, MAX_STOPS);
  const last = stops.at(-1);
  const via = stops.slice(0, -1).map(at).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(at(last))}${via ? `&waypoints=${encodeURIComponent(via)}` : ""}&travelmode=driving`;
}

/**
 * @param day "YYYY-MM-DD" in the bot's time zone
 * @returns {{ stops: [{ v, listing, lead, leg? }], missing: number[], url: string|null }}
 *   leg (from the stop before, both with a pin): { km, minutes, free, tight }
 */
function dayPlan(state, timeZone, day, now = Date.now()) {
  const length = require("./selfbooking").settings(state).length;
  const list = viewings
    .upcoming(state, now)
    .filter((v) => zoneNow(timeZone, v.at).day === day)
    .sort((a, b) => a.at - b.at);
  const stops = list.map((v) => ({ v, listing: re.get(state, v.listing), lead: leads.get(state, v.lead) }));
  for (const [i, s] of stops.entries()) {
    const prev = stops[i - 1];
    if (!prev || !prev.listing?.geo || !s.listing?.geo || prev.listing.id === s.listing.id) continue;
    const km = places.distanceKm(prev.listing.geo, s.listing.geo);
    const minutes = driveMinutes(km);
    const free = Math.round((s.v.at - prev.v.at) / 60000) - length; // after the viewing before ends
    s.leg = { km, minutes, free, tight: free < minutes };
  }
  const missing = [...new Set(stops.filter((s) => s.listing && !s.listing.geo).map((s) => s.listing.id))];
  // One link through the pinned stops, the same place once in a row.
  const points = stops.map((s) => s.listing?.geo).filter(Boolean).filter((p, i, a) => i === 0 || p.lat !== a[i - 1].lat || p.lng !== a[i - 1].lng);
  return { stops, missing, url: points.length ? routeUrl(points) : null };
}

const clock = (t, timeZone) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(t));

/** The plan as a message. showOwner: the listing owners' numbers (private: the agent's own chat only). */
function text(state, plan, timeZone, { title, p = ".", showOwner = false } = {}) {
  const lines = [title, ""];
  for (const s of plan.stops) {
    if (s.leg) {
      lines.push(
        s.leg.tight
          ? `   ⚠️ ${places.km(s.leg.km)} (حوالي ${s.leg.minutes} دقيقة سواقة) وقدامك ${Math.max(0, s.leg.free)} دقيقة بس بعد المعاينة اللي قبلها`
          : `   🚗 ${places.km(s.leg.km)} · حوالي ${s.leg.minutes} دقيقة`,
      );
    }
    const l = s.listing;
    const c = s.lead;
    lines.push(
      `${s.v.outcome ? "✅" : "🕐"} *${clock(s.v.at, timeZone)}* — ${l ? `${l.type || "عقار"}${l.location ? ` ${l.location.slice(0, 30)}` : ""} (#${l.id})` : `#${s.v.listing}`}`,
      `   👤 ${c ? `${c.name || "عميل"}${c.phone ? ` +${c.phone}` : ""} (#${c.id})` : `#${s.v.lead}`}${showOwner && l?.owner?.phone ? ` · 🔑 المالك +${l.owner.phone}` : showOwner && l?.source?.phones?.[0] ? ` · 🔗 السمسار +${l.source.phones[0]}` : ""}`,
    );
  }
  if (plan.url) lines.push("", `🗺️ الطريق بالترتيب: ${plan.url}`);
  if (plan.missing.length) lines.push("", `📍 من غير لوكيشن: ${plan.missing.map((id) => `#${id}`).join("، ")} — ${p}listing loc <رقم> (رد على لوكيشن)`);
  return lines.join("\n");
}

module.exports = { dayPlan, text, routeUrl, driveMinutes, MAX_STOPS };
