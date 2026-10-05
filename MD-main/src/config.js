"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Configuration: read once from the environment (and `.env`), validated, frozen.
 * Every problem is reported at once so the operator can fix them in one pass.
 * To add a new setting, see docs/ADDING_FEATURES.md ("Adding a config value").
 */

class ConfigError extends Error {
  constructor(problems) {
    super("Invalid configuration:\n" + problems.map((p) => `  - ${p}`).join("\n"));
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * Expands a leading "~" to the home directory. Shells do this, but .env files and
 * Node's spawn() do not, so "YTDLP_PATH=~/.local/bin/yt-dlp" would otherwise point at
 * a folder literally named "~".
 */
function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** A program name ("ffmpeg") is looked up in PATH; anything with a slash is a file path. */
function toolPath(value) {
  const v = expandHome(value);
  return /[\\/]/.test(v) ? path.resolve(v) : v;
}

function loadEnvFile(file = path.resolve(".env")) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function createReader(env, problems) {
  const str = (name, def = "") => {
    const v = env[name];
    return v === undefined || v.trim() === "" ? def : v.trim();
  };

  const int = (name, def, min, max) => {
    const raw = str(name);
    if (raw === "") return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be a whole number between ${min} and ${max} (got "${raw}")`);
      return def;
    }
    return n;
  };

  const bool = (name, def) => {
    const raw = str(name);
    if (raw === "") return def;
    if (/^(1|true|yes|on)$/i.test(raw)) return true;
    if (/^(0|false|no|off)$/i.test(raw)) return false;
    problems.push(`${name} must be true or false (got "${raw}")`);
    return def;
  };

  const oneOf = (name, def, allowed) => {
    const raw = str(name, def).toLowerCase();
    if (!allowed.includes(raw)) {
      problems.push(`${name} must be one of: ${allowed.join(", ")} (got "${raw}")`);
      return def;
    }
    return raw;
  };

  const list = (name) =>
    str(name)
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  return { str, int, bool, oneOf, list };
}

function parsePhoneList(values, name, problems) {
  const out = [];
  for (const value of values) {
    const digits = value.replace(/[+\-()\s]/g, "");
    if (!/^\d+$/.test(digits)) {
      problems.push(`${name}: "${value}" is not a phone number`);
    } else if (digits.startsWith("0")) {
      problems.push(
        `${name}: "${value}" starts with 0. Use the full international number with country code and ` +
          `without the leading 0 (for example Egypt 01012345678 → 201012345678).`,
      );
    } else if (digits.length < 7 || digits.length > 15) {
      problems.push(`${name}: "${value}" must be 7 to 15 digits including the country code`);
    } else {
      out.push(digits);
    }
  }
  return out;
}

function buildConfig(env = process.env) {
  const problems = [];
  const r = createReader(env, problems);

  const ownerNumbers = parsePhoneList(r.list("OWNER_NUMBERS"), "OWNER_NUMBERS", problems);
  if (r.list("OWNER_NUMBERS").length === 0) {
    problems.push("OWNER_NUMBERS is required: your WhatsApp number(s) with country code, e.g. 201012345678");
  }
  const ownerLids = r.list("OWNER_LIDS").map((v) => v.replace(/@lid$/, ""));
  for (const lid of ownerLids) {
    if (!/^\d{6,20}$/.test(lid)) problems.push(`OWNER_LIDS: "${lid}" must be digits (see .whoami)`);
  }

  const pairing = r.str("PAIRING_NUMBER");
  const pairingNumber = pairing ? parsePhoneList([pairing], "PAIRING_NUMBER", problems)[0] : null;

  const prefix = r.str("PREFIX", ".");
  if (!/^\S{1,3}$/.test(prefix)) problems.push(`PREFIX must be 1-3 non-space characters (got "${prefix}")`);

  const aiEffort = r.oneOf("AI_EFFORT", "low", ["low", "medium", "high", "xhigh", "max"]);

  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezone = r.str("TIMEZONE", systemZone);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    problems.push(`TIMEZONE must be an IANA time zone such as Africa/Cairo or Europe/London (got "${timezone}")`);
  }

  const githubRepo = r.str("GITHUB_REPO");
  if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) {
    problems.push(`GITHUB_REPO must look like owner/repository (got "${githubRepo}")`);
  }

  const isTty = Boolean(process.stdout.isTTY);
  const config = {
    bot: {
      name: r.str("BOT_NAME", "WhatsApp Bot"),
      ownerName: r.str("OWNER_NAME", "Owner"),
      prefix,
      defaultMode: r.oneOf("MODE", "public", ["public", "private"]),
      markOnline: r.bool("MARK_ONLINE", true),
      stickerPack: r.str("STICKER_PACK", r.str("BOT_NAME", "WhatsApp Bot")),
      stickerAuthor: r.str("STICKER_AUTHOR", ""),
      timezone,
    },
    owners: {
      numbers: Object.freeze([...new Set(ownerNumbers)]),
      lids: Object.freeze([...new Set(ownerLids)]),
    },
    pairingNumber,
    paths: {
      session: path.resolve(expandHome(r.str("SESSION_DIR", "session"))),
      data: path.resolve(expandHome(r.str("DATA_DIR", "data"))),
      tmp: path.resolve(expandHome(r.str("TMP_DIR", "tmp"))),
    },
    log: {
      level: r.oneOf("LOG_LEVEL", "info", ["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
      format: r.oneOf("LOG_FORMAT", isTty ? "pretty" : "json", ["pretty", "json"]),
      baileysLevel: r.oneOf("BAILEYS_LOG_LEVEL", "silent", ["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
    },
    health: {
      port: r.int("HEALTH_PORT", 3000, 0, 65535),
      host: r.str("HEALTH_HOST", "127.0.0.1"),
    },
    limits: {
      mediaBytes: r.int("MAX_MEDIA_MB", 25, 1, 200) * 1024 * 1024,
      downloadBytes: r.int("MAX_DOWNLOAD_MB", 50, 1, 500) * 1024 * 1024,
      videoSeconds: r.int("MAX_VIDEO_SECONDS", 600, 10, 7200),
      cooldownSeconds: r.int("DEFAULT_COOLDOWN_SECONDS", 3, 0, 3600),
      warnLimit: r.int("WARN_LIMIT", 3, 1, 20),
      storeChats: r.int("STORE_MAX_CHATS", 500, 10, 100000),
      storePerChat: r.int("STORE_MESSAGES_PER_CHAT", 20, 1, 500),
      antideleteMessages: r.int("ANTIDELETE_MAX_MESSAGES", 5000, 100, 100000),
      antideleteMediaBytes: r.int("ANTIDELETE_MAX_MEDIA_MB", 10, 0, 100) * 1024 * 1024,
    },
    tools: {
      ffmpeg: toolPath(r.str("FFMPEG_PATH", "ffmpeg")),
      ytdlp: toolPath(r.str("YTDLP_PATH", "yt-dlp")),
      ytdlpCookies: r.str("YTDLP_COOKIES") ? path.resolve(expandHome(r.str("YTDLP_COOKIES"))) : "",
      fontFile: toolPath(r.str("FONT_FILE", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    },
    ai: {
      // Claude via the official Anthropic SDK. AI commands are disabled when no key is set.
      apiKey: r.str("ANTHROPIC_API_KEY"),
      model: r.str("AI_MODEL", "claude-opus-5-5"),
      effort: aiEffort,
      maxTokens: r.int("AI_MAX_TOKENS", 1024, 64, 16000),
      persona: r.str(
        "CHATBOT_PERSONA",
        "You are a friendly, concise assistant in a WhatsApp chat. Reply in the user's language in at most three short sentences. Never use insults or slurs.",
      ),
    },
    keys: {
      newsApi: r.str("NEWSAPI_KEY"),
      openWeather: r.str("OPENWEATHER_KEY"),
      tenor: r.str("TENOR_KEY"),
      telegramBot: r.str("TELEGRAM_BOT_TOKEN"),
      removeBg: r.str("REMOVEBG_API_KEY"),
      remini: r.str("REMINI_API_KEY"),
    },
    githubRepo,
    update: {
      // .update pulls only from this git remote and branch of the clone the bot runs from.
      remote: r.str("UPDATE_REMOTE", "origin"),
      branch: r.str("UPDATE_BRANCH", "main"),
    },
  };
  for (const [name, value] of [["UPDATE_REMOTE", config.update.remote], ["UPDATE_BRANCH", config.update.branch]]) {
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(value) || value.startsWith("-")) problems.push(`${name} contains invalid characters`);
  }

  if (problems.length) throw new ConfigError(problems);
  return deepFreeze(config);
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(obj);
}

module.exports = { buildConfig, loadEnvFile, ConfigError, expandHome, toolPath };
