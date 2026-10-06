"use strict";

const pino = require("pino");

/** Shows only the last 4 digits of a phone number or JID user part. */
function maskJid(value) {
  const s = String(value ?? "");
  const [user, server] = s.split("@");
  const digits = user.split(":")[0];
  if (!/^\d+$/.test(digits)) return s;
  const masked = digits.length <= 4 ? "****" : "*".repeat(digits.length - 4) + digits.slice(-4);
  return server ? `${masked}@${server}` : masked;
}

const REDACT_PATHS = [
  "creds",
  "*.creds",
  "auth",
  "*.auth",
  "apiKey",
  "*.apiKey",
  "token",
  "*.token",
  "keys",
  "*.keys",
  "config.ai.apiKey",
  "config.ai.keys",
  "config.keys",
  "value",
  "*.value",
  "cookies",
  "*.cookies",
  "headers.authorization",
  'headers["x-api-key"]',
  'headers["x-goog-api-key"]',
  "*.headers.authorization",
  '*.headers["x-goog-api-key"]',
];

function createLogger({ level = "info", format = "json" } = {}) {
  const options = { level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  if (format === "pretty") {
    return pino({
      ...options,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } },
    });
  }
  return pino(options);
}

module.exports = { createLogger, maskJid, REDACT_PATHS };
