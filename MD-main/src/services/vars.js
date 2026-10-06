"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite } = require("../core/state");
const { expandHome, ConfigError } = require("../config");
const { UserError } = require("../core/errors");

/**
 * Settings the owner can change from WhatsApp (.setvar, .setai, .aimodel …).
 *
 * They are saved in DATA_DIR/env-overrides.json (mode 600) and override .env, so they
 * work the same under PM2 and Docker (where .env is read-only inside the container).
 * Deleting a value (.delvar) falls back to .env / the default again.
 *
 * Only the settings listed here can be changed from chat. Owner numbers, folders,
 * the update source, pairing and the health server stay in .env on purpose: changing
 * them from a chat message could lock you out or hand control of updates to someone else.
 */

const FILE = "env-overrides.json";

/** @type {Array<{key, group, about, secret?: boolean, restart?: boolean, example?: string}>} */
const SETTINGS = [
  // AI
  { key: "AI_PROVIDER", group: "AI", about: "Which AI answers: auto, claude, gemini or openai (auto = first one with a key)", example: "gemini" },
  { key: "ANTHROPIC_API_KEY", group: "AI", about: "Claude key (console.anthropic.com)", secret: true },
  { key: "GEMINI_API_KEY", group: "AI", about: "Gemini key (aistudio.google.com/apikey)", secret: true },
  { key: "OPENAI_API_KEY", group: "AI", about: "OpenAI, or any OpenAI-compatible service's key", secret: true },
  { key: "OPENAI_BASE_URL", group: "AI", about: "OpenAI-compatible endpoint, e.g. https://api.groq.com/openai/v1", example: "https://openrouter.ai/api/v1" },
  { key: "CLAUDE_MODEL", group: "AI", about: "Claude model (.aimodel lists them)", example: "claude-opus-5-5" },
  { key: "GEMINI_MODEL", group: "AI", about: "Gemini model (.aimodel lists them)", example: "gemini-3.8-flash" },
  { key: "OPENAI_MODEL", group: "AI", about: "OpenAI-compatible model (.aimodel lists them)", example: "gpt-6-luna" },
  { key: "AI_MAX_TOKENS", group: "AI", about: "Maximum answer length (64-16000)", example: "2048" },
  { key: "AI_EFFORT", group: "AI", about: "Claude thinking effort: low, medium, high, xhigh, max", example: "medium" },
  { key: "CHATBOT_PERSONA", group: "AI", about: "Instructions for the group chatbot", example: "You are a funny Egyptian friend. Reply in Arabic." },
  // Bot
  { key: "BOT_NAME", group: "Bot", about: "Name in .help, .alive, .ping", example: "Akram Bot" },
  { key: "OWNER_NAME", group: "Bot", about: "Your name on the .owner contact card", example: "Akram" },
  { key: "PREFIX", group: "Bot", about: "Command prefix (1-3 characters)", example: "!" },
  { key: "STICKER_PACK", group: "Bot", about: "Pack name written into stickers", example: "My Pack" },
  { key: "STICKER_AUTHOR", group: "Bot", about: "Author written into stickers", example: "Akram" },
  { key: "TIMEZONE", group: "Bot", about: "Time zone for .time and .remind", example: "Africa/Cairo" },
  { key: "MARK_ONLINE", group: "Bot", about: "Show the bot as online (true/false)", restart: true, example: "false" },
  // API keys
  { key: "NEWSAPI_KEY", group: "API keys", about: ".news (newsapi.org)", secret: true },
  { key: "TENOR_KEY", group: "API keys", about: ".emojimix (Google Cloud key with Tenor API)", secret: true },
  { key: "TELEGRAM_BOT_TOKEN", group: "API keys", about: ".tg Telegram sticker packs (@BotFather)", secret: true },
  { key: "REMOVEBG_API_KEY", group: "API keys", about: ".removebg (remove.bg)", secret: true },
  { key: "REMINI_API_KEY", group: "API keys", about: ".remini", secret: true },
  { key: "GITHUB_REPO", group: "API keys", about: ".github: owner/repository", example: "akrmz/whatsagent" },
  // Limits
  { key: "MAX_MEDIA_MB", group: "Limits", about: "Largest WhatsApp media a command downloads (MB)", example: "25" },
  { key: "MAX_DOWNLOAD_MB", group: "Limits", about: "Largest file the downloaders fetch (MB)", example: "50" },
  { key: "MAX_VIDEO_SECONDS", group: "Limits", about: "Longest audio/video the downloaders fetch (s)", example: "900" },
  { key: "DEFAULT_COOLDOWN_SECONDS", group: "Limits", about: "Default per-user cooldown (s)", example: "3" },
  { key: "WARN_LIMIT", group: "Limits", about: "Warnings before a member is removed", example: "3" },
  // Tools
  { key: "YTDLP_PATH", group: "Tools", about: "yt-dlp program or full path (~ allowed); checked before saving", example: "~/.local/bin/yt-dlp" },
  { key: "FFMPEG_PATH", group: "Tools", about: "ffmpeg program or full path; checked before saving", example: "/usr/bin/ffmpeg" },
  { key: "LOG_LEVEL", group: "Tools", about: "fatal, error, warn, info, debug", restart: true, example: "info" },
];
const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
const GROUPS = [...new Set(SETTINGS.map((s) => s.group))];

const dataDirOf = (env) => path.resolve(expandHome(String(env.DATA_DIR || "").trim() || "data"));
const fileOf = (dataDir) => path.join(dataDir, FILE);

/** Reads the overrides; unknown keys and non-string values are ignored. */
function load(dataDir, log) {
  const file = fileOf(dataDir);
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) {
      if (BY_KEY.has(k) && typeof v === "string") out[k] = v;
      else log?.warn({ key: k }, "ignoring unknown setting in env-overrides.json");
    }
    return out;
  } catch (err) {
    log?.error({ err: err.message }, "env-overrides.json is unreadable; chat settings ignored");
    return {};
  }
}

function save(dataDir, overrides) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  atomicWrite(fileOf(dataDir), overrides);
}

/** Where the current value of a setting comes from. */
function sourceOf(key, baseEnv, overrides) {
  if (Object.hasOwn(overrides, key)) return "chat";
  if (String(baseEnv[key] || "").trim()) return ".env";
  return "default";
}

// The value the bot actually uses for each setting (after .env, chat settings and defaults).
const MB = 1024 * 1024;
const EFFECTIVE = {
  AI_PROVIDER: (c) => c.ai.provider,
  ANTHROPIC_API_KEY: (c) => c.ai.keys.claude,
  GEMINI_API_KEY: (c) => c.ai.keys.gemini,
  OPENAI_API_KEY: (c) => c.ai.keys.openai,
  OPENAI_BASE_URL: (c) => c.ai.openaiBaseUrl,
  CLAUDE_MODEL: (c) => c.ai.models.claude,
  GEMINI_MODEL: (c) => c.ai.models.gemini,
  OPENAI_MODEL: (c) => c.ai.models.openai,
  AI_MAX_TOKENS: (c) => c.ai.maxTokens,
  AI_EFFORT: (c) => c.ai.effort,
  CHATBOT_PERSONA: (c) => c.ai.persona,
  BOT_NAME: (c) => c.bot.name,
  OWNER_NAME: (c) => c.bot.ownerName,
  PREFIX: (c) => c.bot.prefix,
  STICKER_PACK: (c) => c.bot.stickerPack,
  STICKER_AUTHOR: (c) => c.bot.stickerAuthor,
  TIMEZONE: (c) => c.bot.timezone,
  MARK_ONLINE: (c) => c.bot.markOnline,
  NEWSAPI_KEY: (c) => c.keys.newsApi,
  TENOR_KEY: (c) => c.keys.tenor,
  TELEGRAM_BOT_TOKEN: (c) => c.keys.telegramBot,
  REMOVEBG_API_KEY: (c) => c.keys.removeBg,
  REMINI_API_KEY: (c) => c.keys.remini,
  GITHUB_REPO: (c) => c.githubRepo,
  MAX_MEDIA_MB: (c) => c.limits.mediaBytes / MB,
  MAX_DOWNLOAD_MB: (c) => c.limits.downloadBytes / MB,
  MAX_VIDEO_SECONDS: (c) => c.limits.videoSeconds,
  DEFAULT_COOLDOWN_SECONDS: (c) => c.limits.cooldownSeconds,
  WARN_LIMIT: (c) => c.limits.warnLimit,
  YTDLP_PATH: (c) => c.tools.ytdlp,
  FFMPEG_PATH: (c) => c.tools.ffmpeg,
  LOG_LEVEL: (c) => c.log.level,
};
const effective = (key, config) => {
  const v = EFFECTIVE[key]?.(config);
  return v === undefined || v === null ? "" : String(v);
};

/** A secret is never shown; only whether it is set. */
const display = (setting, value) => {
  if (!value) return "—";
  if (setting.secret) return `••••• (${value.length} chars)`;
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
};

/**
 * Validates, saves and applies changes ({ KEY: "value" } to set, { KEY: null } to remove).
 * Throws a UserError listing the problems; nothing is saved then.
 * @returns {Promise<{ enabled: string[], disabled: string[], restart: string[] }>}
 */
async function apply(app, changes) {
  const next = { ...app.overrides };
  for (const [key, value] of Object.entries(changes)) {
    if (!BY_KEY.has(key)) throw new UserError(`${key} can't be changed from chat.`);
    if (value === null) delete next[key];
    else next[key] = String(value);
  }
  let diff;
  try {
    diff = await app.reconfigure(next);
  } catch (err) {
    if (err instanceof ConfigError) throw new UserError(`Not saved:\n${err.problems.map((p) => `• ${p}`).join("\n")}`);
    throw err;
  }
  return { ...diff, restart: Object.keys(changes).filter((k) => BY_KEY.get(k).restart) };
}

/** One line telling the owner what a change did to the command list. */
function describeDiff({ enabled, disabled, restart }, prefix) {
  const lines = [];
  if (enabled.length) lines.push(`➕ Now available: ${enabled.map((n) => prefix + n).join(", ")}`);
  if (disabled.length) lines.push(`➖ Now disabled: ${disabled.map((n) => prefix + n).join(", ")}`);
  if (restart.length) lines.push(`🔁 ${restart.join(", ")} takes effect after a restart (${prefix}restart).`);
  return lines.join("\n");
}

module.exports = { SETTINGS, BY_KEY, GROUPS, load, save, apply, describeDiff, sourceOf, display, effective, dataDirOf, FILE };
