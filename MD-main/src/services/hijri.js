"use strict";

/**
 * Hijri dates with the Umm al-Qura calendar built into Node (no internet needed).
 * Real start dates of months can differ by a day where they depend on moon sighting.
 */

const MONTHS_AR = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];

/** @returns {{ day: number, month: number, year: number, monthName: string }} */
function toHijri(date, timeZone = "UTC") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const month = Number(parts.month);
  return { day: Number(parts.day), month, year: Number(String(parts.year).replace(/\D/g, "")), monthName: MONTHS_AR[month - 1] };
}

const format = (h) => `${h.day} ${h.monthName} ${h.year} هـ`;

// Islamic occasions by Hijri month/day.
const OCCASIONS = [
  { month: 1, day: 1, name: "رأس السنة الهجرية" },
  { month: 1, day: 10, name: "يوم عاشوراء" },
  { month: 9, day: 1, name: "بداية شهر رمضان" },
  { month: 9, day: 27, name: "ليلة 27 رمضان (ليلة القدر المرجوّة في العشر الأواخر)" },
  { month: 10, day: 1, name: "عيد الفطر" },
  { month: 12, day: 9, name: "يوم عرفة" },
  { month: 12, day: 10, name: "عيد الأضحى" },
];

/** The next date (from `from`) whose Hijri month/day match, and how many days away it is. */
function nextOccurrence(month, day, from = new Date(), timeZone = "UTC") {
  for (let i = 0; i <= 400; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    const h = toHijri(d, timeZone);
    if (h.month === month && h.day === day) return { date: d, days: i, hijri: h };
  }
  return null;
}

/** Upcoming occasions, soonest first. */
function upcoming(from = new Date(), timeZone = "UTC") {
  return OCCASIONS.map((o) => ({ ...o, ...nextOccurrence(o.month, o.day, from, timeZone) }))
    .filter((o) => o.date)
    .sort((a, b) => a.days - b.days);
}

module.exports = { toHijri, format, nextOccurrence, upcoming, MONTHS_AR, OCCASIONS };
