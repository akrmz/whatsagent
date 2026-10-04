import pino from "pino";

/** Shows only the last 4 digits of a phone number, e.g. "*******1234". */
export function maskNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

export function createLogger(level = "info") {
  return pino({
    level,
    redact: {
      paths: [
        "creds",
        "*.creds",
        "token",
        "*.token",
        "code",
        "*.code",
        "req.headers.authorization",
        'req.headers["x-access-token"]',
      ],
      censor: "[redacted]",
    },
  });
}
