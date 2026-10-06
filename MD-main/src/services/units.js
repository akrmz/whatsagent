"use strict";

const { UserError } = require("../core/errors");

/** Offline unit conversion for .unit. Each unit maps to a factor of its kind's base unit. */

const KINDS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, um: 1e-6, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318, ct: 0.0002 },
  volume: { l: 1, ml: 0.001, m3: 1000, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375 },
  area: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 1e4, acre: 4046.8564224, ft2: 0.09290304, yd2: 0.83612736, mi2: 2589988.110336, feddan: 4200.83, qirat: 175.03 },
  speed: { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 0.514444, "ft/s": 0.3048 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, bit: 0.125, mbit: 125000, gbit: 1.25e8 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 },
  energy: { j: 1, kj: 1000, cal: 4.184, kcal: 4184, wh: 3600, kwh: 3.6e6 },
  temperature: { c: null, f: null, k: null },
};

const ALIASES = {
  meter: "m", meters: "m", metre: "m", metres: "m", kilometer: "km", kilometers: "km", kms: "km", centimeter: "cm", centimeters: "cm",
  millimeter: "mm", millimeters: "mm", mile: "mi", miles: "mi", yard: "yd", yards: "yd", foot: "ft", feet: "ft", inch: "in", inches: "in", '"': "in", "'": "ft",
  kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg", gram: "g", grams: "g", gr: "g", ton: "t", tons: "t", tonne: "t", tonnes: "t",
  pound: "lb", pounds: "lb", lbs: "lb", ounce: "oz", ounces: "oz", stone: "st", carat: "ct", carats: "ct",
  liter: "l", liters: "l", litre: "l", litres: "l", milliliter: "ml", milliliters: "ml", gallon: "gal", gallons: "gal", quart: "qt", pint: "pt", cups: "cup",
  "m³": "m3", "m^3": "m3", "m²": "m2", "m^2": "m2", "km²": "km2", "km^2": "km2", "cm²": "cm2", hectare: "ha", hectares: "ha", acres: "acre", "ft²": "ft2", sqft: "ft2", "sq ft": "ft2",
  feddans: "feddan", fadan: "feddan", "فدان": "feddan", "قيراط": "qirat",
  kmh: "km/h", kph: "km/h", "km/hr": "km/h", ms: "ms", mps: "m/s", knot: "kn", knots: "kn", kt: "kn",
  byte: "b", bytes: "b", kilobyte: "kb", megabyte: "mb", gigabyte: "gb", terabyte: "tb", bits: "bit", mbps: "mbit", gbps: "gbit",
  sec: "s", secs: "s", second: "s", seconds: "s", mins: "min", minute: "min", minutes: "min", hr: "h", hrs: "h", hour: "h", hours: "h",
  days: "day", d: "day", weeks: "week", wk: "week", months: "month", years: "year", yr: "year", yrs: "year",
  joule: "j", joules: "j", calorie: "cal", calories: "cal", kcals: "kcal",
  "°c": "c", celsius: "c", "°f": "f", fahrenheit: "f", kelvin: "k",
};

function resolve(name) {
  const n = String(name || "").toLowerCase().trim();
  const unit = ALIASES[n] || n;
  for (const [kind, units] of Object.entries(KINDS)) if (Object.hasOwn(units, unit)) return { kind, unit };
  return null;
}

const toKelvin = { c: (v) => v + 273.15, f: (v) => ((v - 32) * 5) / 9 + 273.15, k: (v) => v };
const fromKelvin = { c: (v) => v - 273.15, f: (v) => ((v - 273.15) * 9) / 5 + 32, k: (v) => v };

/** convert(10, "km", "mi") → { value, from, to, kind } */
function convert(value, fromName, toName) {
  const from = resolve(fromName);
  const to = resolve(toName);
  if (!from) throw new UserError(`Unknown unit "${fromName}".`);
  if (!to) throw new UserError(`Unknown unit "${toName}".`);
  if (from.kind !== to.kind) throw new UserError(`Can't convert ${from.kind} (${from.unit}) to ${to.kind} (${to.unit}).`);
  const result =
    from.kind === "temperature" ? fromKelvin[to.unit](toKelvin[from.unit](value)) : (value * KINDS[from.kind][from.unit]) / KINDS[to.kind][to.unit];
  return { value: result, from: from.unit, to: to.unit, kind: from.kind };
}

/** "10 km to mi", "5'ft in cm", "100 f c" → { value, from, to } */
function parse(text) {
  const m = String(text)
    .trim()
    .match(/^(-?[\d.,]+)\s*([^\s\d][^\s]*?|sq ft)\s+(?:to\s+|in\s+|into\s+|=\s*|->\s*)?([^\s]+)$/i);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { value, from: m[2], to: m[3] } : null;
}

const unitList = () =>
  Object.entries(KINDS)
    .map(([kind, units]) => `*${kind}*: ${Object.keys(units).join(", ")}`)
    .join("\n");

module.exports = { convert, parse, resolve, unitList, KINDS };
