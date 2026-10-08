"use strict";

/** Phone numbers as WhatsApp uses them: digits with the country code (shared by clients, tenants and listing owners). */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));

// Calling codes, longest first when matching the owner's number (enough for the region and the common ones).
const CODES = ["20", "966", "971", "965", "974", "973", "968", "962", "961", "963", "964", "967", "970", "212", "213", "216", "218", "249", "90", "44", "1", "33", "34", "39", "49", "7", "91", "92", "86"];
const codeOf = (number) => {
  const d = String(number || "").replace(/\D/g, "");
  return [3, 2, 1].map((n) => d.slice(0, n)).find((p) => CODES.includes(p)) || null;
};

/**
 * "0100 123 4567" (local) → "201001234567" using the owner's country code; "+20 100 …",
 * "00201…" → "201…". @returns {string|null} digits, or null if it doesn't look like a number
 */
function normalizePhone(text, ownerNumber) {
  let d = latin(String(text || "")).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) {
    const cc = codeOf(ownerNumber);
    if (!cc) return null;
    d = cc + d.slice(1);
  } else if (d.length <= 9) {
    // Local numbers without a leading 0 (Kuwait, Qatar … use 8 digits); shorter is not a phone number.
    const cc = codeOf(ownerNumber);
    if (d.length < 7 || !cc) return null;
    if (!d.startsWith(cc)) d = cc + d;
  }
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

module.exports = { normalizePhone, codeOf, CODES };
