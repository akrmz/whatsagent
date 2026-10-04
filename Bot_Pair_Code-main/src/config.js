import fs from "node:fs";
import path from "node:path";

/**
 * Loads `.env` (if present) and validates every setting once at startup.
 * Throws a ConfigError listing *all* problems so they can be fixed in one go.
 */
export class ConfigError extends Error {
  constructor(problems) {
    super(
      "Invalid configuration:\n" + problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadEnvFile(file = path.resolve(".env")) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function int(env, name, def, { min, max }, problems) {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    return def;
  }
  return n;
}

function bool(env, name, def, problems) {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  problems.push(`${name} must be true or false (got "${raw}")`);
  return def;
}

export function buildConfig(env = process.env) {
  const problems = [];

  const accessToken = env.PAIR_ACCESS_TOKEN || "";
  if (accessToken.length < 16) {
    problems.push(
      "PAIR_ACCESS_TOKEN is required and must be at least 16 characters " +
        "(generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\")",
    );
  }

  const delivery = (env.PAIR_DELIVERY || "local").toLowerCase();
  if (!["local", "whatsapp"].includes(delivery)) {
    problems.push(`PAIR_DELIVERY must be "local" or "whatsapp" (got "${env.PAIR_DELIVERY}")`);
  }

  const logLevel = env.LOG_LEVEL || "info";
  if (!["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(logLevel)) {
    problems.push(`LOG_LEVEL must be one of fatal|error|warn|info|debug|trace|silent (got "${logLevel}")`);
  }

  const config = {
    port: int(env, "PORT", 8000, { min: 1, max: 65535 }, problems),
    host: env.HOST || "127.0.0.1",
    accessToken,
    delivery,
    sessionOutputDir: path.resolve(env.SESSION_OUTPUT_DIR || "../MD-main/session"),
    overwriteSession: bool(env, "PAIR_OVERWRITE", false, problems),
    workDir: path.resolve(env.PAIR_WORK_DIR || "pair-sessions"),
    maxConcurrent: int(env, "MAX_CONCURRENT_SESSIONS", 2, { min: 1, max: 20 }, problems),
    timeoutSeconds: int(env, "PAIR_TIMEOUT_SECONDS", 180, { min: 30, max: 900 }, problems),
    rateLimitWindowSeconds: int(env, "RATE_LIMIT_WINDOW_SECONDS", 600, { min: 1, max: 86400 }, problems),
    rateLimitMax: int(env, "RATE_LIMIT_MAX", 5, { min: 1, max: 1000 }, problems),
    trustProxy: bool(env, "TRUST_PROXY", false, problems),
    logLevel,
  };

  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}
