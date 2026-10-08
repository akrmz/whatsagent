"use strict";

const re = require("./realestate");

/**
 * English versions of listings for foreign buyers (.listing 12 en, .flyer 12 en, .story 12 en):
 * the fixed words are translated, common Egyptian areas get their usual English names, and
 * a listing can carry its own English location (listing.locationEn). Free text (notes) stays
 * as written unless it is already in English.
 */

const TYPES = {
  شقة: "Apartment", فيلا: "Villa", دوبلكس: "Duplex", بنتهاوس: "Penthouse", "تاون هاوس": "Townhouse", "توين هاوس": "Twin house",
  شاليه: "Chalet", استوديو: "Studio", محل: "Shop", مكتب: "Office", عيادة: "Clinic", أرض: "Land", عمارة: "Building",
};
const DEALS = { بيع: "for sale", إيجار: "for rent" };
const STATUS = { available: "Available", reserved: "Reserved", sold: "Sold", rented: "Rented" };
const FINISHING = [
  [/ألترا سوبر لوكس|الترا سوبر لوكس/, "Ultra super lux"],
  [/سوبر لوكس/, "Super lux"],
  [/نص تشطيب|نصف تشطيب/, "Semi-finished"],
  [/على المحارة|علي المحارة|core and shell/i, "Core & shell"],
  [/تشطيب كامل|متشطب|fully finished/i, "Fully finished"],
  [/بدون تشطيب/, "Unfinished"],
  [/لوكس/, "Lux"],
  [/semi finished/i, "Semi-finished"],
];
const ORDINAL_AR = { الأرضي: 0, الارضي: 0, أرضي: 0, ارضي: 0, الأول: 1, الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6, السابع: 7, الثامن: 8, التاسع: 9, العاشر: 10 };
// Longest first, so "التجمع الخامس" wins over "التجمع".
const AREAS = [
  ["العاصمة الإدارية الجديدة", "New Administrative Capital"], ["العاصمة الإدارية", "New Administrative Capital"], ["العاصمة الادارية", "New Administrative Capital"],
  ["التجمع الخامس", "Fifth Settlement, New Cairo"], ["التجمع الأول", "First Settlement, New Cairo"], ["التجمع الاول", "First Settlement, New Cairo"], ["التجمع", "New Cairo"],
  ["القاهرة الجديدة", "New Cairo"], ["الشيخ زايد", "Sheikh Zayed"], ["زايد", "Sheikh Zayed"], ["6 أكتوبر", "6th of October"], ["٦ أكتوبر", "6th of October"], ["أكتوبر", "6th of October"], ["اكتوبر", "6th of October"],
  ["المعادي", "Maadi"], ["مدينتي", "Madinaty"], ["الرحاب", "Al Rehab"], ["الزمالك", "Zamalek"], ["مصر الجديدة", "Heliopolis"], ["مدينة نصر", "Nasr City"],
  ["الساحل الشمالي", "North Coast"], ["الساحل", "North Coast"], ["العين السخنة", "Ain Sokhna"], ["السخنة", "Ain Sokhna"], ["الشروق", "El Shorouk"], ["العبور", "El Obour"],
  ["المهندسين", "Mohandessin"], ["الدقي", "Dokki"], ["حدائق الأهرام", "Hadayek El Ahram"], ["الهرم", "Haram"], ["جاردن سيتي", "Garden City"], ["المقطم", "Mokattam"],
  ["النرجس", "El Narges"], ["اللوتس", "El Lotus"], ["البنفسج", "El Banafseg"], ["الياسمين", "El Yasmeen"], ["بيت الوطن", "Beit El Watan"], ["مستقبل سيتي", "Mostakbal City"],
  ["المستقبل", "Mostakbal City"], ["الإسكندرية", "Alexandria"], ["اسكندرية", "Alexandria"], ["الغردقة", "Hurghada"], ["شرم الشيخ", "Sharm El Sheikh"], ["العلمين", "El Alamein"],
];
const CURRENCY = { جنيه: "EGP", "جنيه مصري": "EGP", ريال: "SAR", "ريال سعودي": "SAR", درهم: "AED", "درهم إماراتي": "AED", "دينار كويتي": "KWD", دينار: "KWD", "ريال قطري": "QAR", دولار: "USD", يورو: "EUR" };

const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ""));
const typeEn = (t) => TYPES[t] || (hasArabic(t) ? "Property" : t || "Property");
const dealEn = (d) => DEALS[d || "بيع"] || "for sale";
const currencyEn = (c) => CURRENCY[String(c || "جنيه").trim()] || (hasArabic(c) ? "EGP" : c);
const finishingEn = (f) => (f ? FINISHING.find(([r]) => r.test(f))?.[1] || (hasArabic(f) ? null : f) : null);

/** "الرابع" → "4th floor", "3" → "3rd floor", "الأرضي" → "Ground floor" */
function floorEn(f) {
  if (f === undefined || f === null || f === "") return null;
  const v = String(f).trim();
  const n = v in ORDINAL_AR ? ORDINAL_AR[v] : /^\d{1,2}$/.test(re.latinDigits(v)) ? Number(re.latinDigits(v)) : null;
  if (n === 0) return "Ground floor";
  if (n !== null) return `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"} floor`;
  if (/الأخير|الاخير|أخير|اخير/.test(v)) return "Top floor";
  return hasArabic(v) ? null : `Floor ${v}`;
}

/**
 * The location in English: the listing's own English location, else the known areas found in
 * it (in order, "التجمع الخامس، النرجس" → "Fifth Settlement, New Cairo — El Narges"), else null.
 */
function locationEn(l) {
  if (l.locationEn) return l.locationEn;
  if (!l.location) return null;
  if (!hasArabic(l.location)) return l.location;
  let rest = l.location;
  const found = [];
  for (const [ar, en] of AREAS) {
    const i = rest.indexOf(ar);
    if (i < 0) continue;
    found.push([i, en]);
    rest = rest.slice(0, i) + " ".repeat(ar.length) + rest.slice(i + ar.length); // keep positions, don't match twice
  }
  if (!found.length) return null;
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, en]) => en))].join(" — ");
}

const short = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n));

/** The pieces every English design uses. */
function details(l, a) {
  const cur = currencyEn(a.currency);
  return {
    title: `${typeEn(l.type)} ${dealEn(l.deal)}`,
    location: locationEn(l),
    price: l.price ? `${cur} ${re.group(l.price)}${l.deal === "إيجار" ? " / month" : ""}` : "Price on request",
    priceShort: l.price ? `${cur} ${short(l.price)}` : null,
    specs: [l.size && `${re.group(l.size)} m²`, l.rooms && `${l.rooms} bed${l.rooms > 1 ? "s" : ""}`, l.baths && `${l.baths} bath${l.baths > 1 ? "s" : ""}`, finishingEn(l.finishing)].filter(Boolean).join("  •  "),
    floor: floorEn(l.floor),
    status: l.status && l.status !== "available" ? STATUS[l.status] : "",
    cut: !(l.status && l.status !== "available") && re.discount(l),
    contact: [a.name, a.phone].filter(Boolean).join("   "),
    cur,
  };
}

/** The English listing card (a WhatsApp message). */
function card(l, a) {
  const d = details(l, a);
  const cut = re.discount(l);
  const ppm = l.price && l.size && l.deal !== "إيجار" ? `💵 ${d.cur} ${re.group(l.price / l.size)} per m²` : null;
  const contact = [a.name && `👤 ${a.name}`, a.phone && `📞 ${a.phone}`, a.company && `🏢 ${a.company}`].filter(Boolean).join(" · ");
  return [
    `🏠 *${d.title}* — #${l.id}`,
    d.location && `📍 ${d.location}`,
    `💰 *${d.price}*${l.price >= 1e5 ? ` (${d.priceShort})` : ""}`,
    cut && `📉 Was ${d.cur} ${re.group(cut.was)} — ${cut.pct}% off`,
    [d.specs, d.floor].filter(Boolean).join("  •  ") || null,
    ppm,
    l.notes && !hasArabic(l.notes) && `📝 ${l.notes}`,
    l.geo && `🗺️ Map: https://maps.google.com/?q=${l.geo.lat},${l.geo.lng}`,
    `🔖 ${STATUS[l.status] || "Available"}`,
    `\nTo ask about it, send: #${l.id} en`,
    contact && `\n${contact}`,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = { card, details, typeEn, dealEn, floorEn, finishingEn, locationEn, currencyEn, AREAS };
