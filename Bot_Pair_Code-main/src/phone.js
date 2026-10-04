import { parsePhoneNumber } from "awesome-phonenumber";

/**
 * Validates an international phone number. Accepts "+15551234567", "15551234567",
 * spaces, dashes and brackets. Returns the E.164 digits without "+", or null.
 */
export function normalizePhoneNumber(input) {
  if (typeof input !== "string") return null;
  if (!/^\+?[0-9 ()-]{7,24}$/.test(input.trim())) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const parsed = parsePhoneNumber("+" + digits);
  if (!parsed.valid) return null;
  return parsed.number.e164.slice(1);
}
