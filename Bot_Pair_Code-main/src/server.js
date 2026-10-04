import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import express from "express";
import helmet from "helmet";
import { createRateLimiter } from "./rateLimit.js";
import { normalizePhoneNumber } from "./phone.js";
import { BusyError } from "./pairing.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function tokenMatches(given, expected) {
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(String(given ?? "")).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createApp({ config, logger, pairing }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(express.json({ limit: "2kb" }));

  app.get("/healthz", (req, res) => {
    res.json({ status: "ok", activeSessions: pairing.activeCount() });
  });

  app.use(express.static(PUBLIC_DIR, { index: "pair.html", dotfiles: "deny" }));

  const limiter = createRateLimiter({
    windowMs: config.rateLimitWindowSeconds * 1000,
    max: config.rateLimitMax,
  });

  const requireToken = (req, res, next) => {
    if (tokenMatches(req.get("x-access-token"), config.accessToken)) return next();
    logger.warn({ ip: req.ip, path: req.path }, "rejected request with missing or wrong access token");
    return res.status(401).json({ error: "Missing or wrong access token." });
  };

  const handleStart = (mode) => async (req, res) => {
    let number;
    if (mode === "code") {
      number = normalizePhoneNumber(req.body?.number);
      if (!number) {
        return res.status(400).json({
          error: "Enter your full international number with country code, e.g. +15551234567.",
        });
      }
    }
    try {
      const result = await pairing.start({ mode, number });
      return res.json(result);
    } catch (err) {
      if (err instanceof BusyError) return res.status(503).json({ error: err.message });
      logger.error({ err }, "could not start pairing");
      return res.status(502).json({ error: err.publicMessage || "Could not start pairing. Try again later." });
    }
  };

  app.post("/api/pair", limiter.middleware, requireToken, handleStart("code"));
  app.post("/api/qr", limiter.middleware, requireToken, handleStart("qr"));
  app.get("/api/status/:id", requireToken, (req, res) => {
    const status = pairing.status(String(req.params.id));
    if (!status) return res.status(404).json({ error: "Unknown or expired pairing." });
    return res.json(status);
  });

  app.use((req, res) => res.status(404).json({ error: "Not found" }));

  // Express 5 forwards async errors here. Never leak stack traces to clients.
  app.use((err, req, res, _next) => {
    logger.error({ err }, "unhandled request error");
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: "Request failed." });
  });

  return app;
}
