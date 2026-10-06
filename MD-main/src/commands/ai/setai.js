"use strict";

const vars = require("../../services/vars");
const { createAi, LABELS } = require("../../services/ai");
const { buildConfig, ConfigError, AI_PROVIDERS, AI_DEFAULT_MODELS } = require("../../config");
const { tryDeleteSecretMessage } = require("../../services/secrets");
const { UserError } = require("../../core/errors");
const { LRU } = require("../../core/lru");

const KEY_VAR = { claude: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY" };
const MODEL_VAR = { claude: "CLAUDE_MODEL", gemini: "GEMINI_MODEL", openai: "OPENAI_MODEL" };
const WHERE = {
  claude: "console.anthropic.com → API keys",
  gemini: "aistudio.google.com/apikey (free tier available)",
  openai: "platform.openai.com/api-keys — or Groq, OpenRouter, DeepSeek … with OPENAI_BASE_URL",
};
const PROVIDER_ALIASES = { anthropic: "claude", google: "gemini", gpt: "openai", chatgpt: "openai" };
const MAX_LIST = 40;

// The last model list shown to the owner, so ".aimodel 3" can pick from it.
const lastList = new LRU({ max: 50, ttlMs: 30 * 60 * 1000 });

const providerOf = (name) => {
  const n = String(name || "").toLowerCase();
  return AI_PROVIDERS.includes(n) ? n : PROVIDER_ALIASES[n] || null;
};

/** Builds the AI for a candidate set of settings, without saving anything. */
function candidateAi(app, changes) {
  let config;
  try {
    config = buildConfig({ ...app.baseEnv, ...app.overrides, ...changes });
  } catch (err) {
    if (err instanceof ConfigError) throw new UserError(`Not saved:\n${err.problems.map((p) => `• ${p}`).join("\n")}`);
    throw err;
  }
  return createAi(config, app.log);
}

function status(ctx) {
  const { app } = ctx;
  const ai = app.ai;
  const keys = app.config.ai.keys;
  const lines = [
    "🤖 *AI settings*",
    "",
    ai ? `In use: *${ai.label}* · model *${ai.model}*` : "In use: none (no API key for the selected provider)",
    `AI_PROVIDER: ${app.config.ai.provider}${String(app.overrides.AI_PROVIDER || app.baseEnv.AI_PROVIDER || "auto") === "auto" ? " (auto)" : ""}`,
    "",
    ...AI_PROVIDERS.map((p) => `${keys[p] ? "🔑" : "▫️"} ${p}: ${keys[p] ? "key set" : "no key"} · model ${app.config.ai.models[p]}`),
    "",
    `Set a key (private chat): ${ctx.prefix}setai <claude|gemini|openai> <api key>`,
    `Switch provider: ${ctx.prefix}setai <provider>   ·   Models: ${ctx.prefix}aimodel`,
    "",
    "Where to get a key:",
    ...AI_PROVIDERS.map((p) => `• ${p}: ${WHERE[p]}`),
  ];
  return ctx.reply(lines.join("\n"));
}

module.exports = [
  {
    name: "setai",
    aliases: ["aiset", "aiprovider"],
    category: "ai",
    description: "Chooses the AI (Claude, Gemini or any OpenAI-compatible service) and sets its API key. The key is tested before it is saved. Without arguments, shows the current AI.",
    usage: "[claude|gemini|openai|auto] [api key] [base url]",
    examples: [".setai gemini AIza…", ".setai claude", ".setai openai gsk_… https://api.groq.com/openai/v1", ".setai"],
    permission: "owner",
    cooldown: 5,
    async run(ctx) {
      const [name, key, baseUrl] = ctx.args;
      if (!name) return status(ctx);
      const changes = {};
      if (name.toLowerCase() === "auto") {
        changes.AI_PROVIDER = "auto";
      } else {
        const provider = providerOf(name);
        if (!provider) return ctx.reply(`Unknown AI "${name}". Choose claude, gemini, openai or auto.`);
        changes.AI_PROVIDER = provider;
        if (key) {
          if (ctx.isGroup) {
            await tryDeleteSecretMessage(ctx);
            return ctx.reply("🔐 Never send API keys in a group. Send it to me in a private chat, and replace this key if others saw it.");
          }
          changes[KEY_VAR[provider]] = key;
        }
        if (baseUrl) {
          if (provider !== "openai") return ctx.reply("A base URL is only used with openai (OpenAI-compatible services).");
          changes.OPENAI_BASE_URL = baseUrl;
        }
      }
      await ctx.react("🔄");
      const ai = candidateAi(ctx.app, changes);
      if (!ai) {
        const p = changes.AI_PROVIDER === "auto" ? "any provider" : changes.AI_PROVIDER;
        return ctx.reply(`There is no API key for ${p} yet. Send (in private chat): ${ctx.prefix}setai ${changes.AI_PROVIDER === "auto" ? "gemini" : changes.AI_PROVIDER} <api key>`);
      }
      // Test the key (and endpoint) with a free request before saving anything.
      let models;
      try {
        models = await ai.listModels();
      } catch (err) {
        if (key) await tryDeleteSecretMessage(ctx);
        throw err instanceof UserError ? new UserError(`Not saved. ${err.message.replace(" The owner can set a new one with .setai.", "")}`) : err;
      }
      const deleted = key ? await tryDeleteSecretMessage(ctx) : false;
      const diff = await vars.apply(ctx.app, changes);
      const warn = models.length && !models.includes(ai.model) ? `\n⚠️ The model ${ai.model} is not in this key's model list. Pick one with ${ctx.prefix}aimodel.` : "";
      return ctx.reply(
        [
          `✅ AI: *${ai.label}* · model *${ai.model}* (${models.length} models available)${warn}`,
          vars.describeDiff(diff, ctx.prefix),
          key && !deleted ? "🧹 Delete your message with the key from this chat." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  },
  {
    name: "aimodel",
    aliases: ["models", "setmodel"],
    category: "ai",
    description: "Lists the models your AI key can use and switches to one (by name or number). Add a word to filter the list.",
    usage: "[model | number | filter]",
    examples: [".aimodel", ".aimodel flash", ".aimodel 3", ".aimodel gemini-3.8-flash"],
    permission: "owner",
    requires: ["ai"],
    cooldown: 5,
    async run(ctx) {
      const { app } = ctx;
      const provider = app.ai.provider;
      const arg = ctx.text.trim();
      const models = await app.ai.listModels();
      const listKey = `${ctx.chatId}|${provider}`;

      let chosen = null;
      if (/^\d{1,3}$/.test(arg)) chosen = lastList.get(listKey)?.[Number(arg) - 1] || null;
      else if (arg && models.includes(arg)) chosen = arg;

      if (chosen) {
        const diff = await vars.apply(app, { [MODEL_VAR[provider]]: chosen });
        return ctx.reply([`✅ ${LABELS[provider]} now uses *${chosen}*.`, vars.describeDiff(diff, ctx.prefix)].filter(Boolean).join("\n"));
      }
      if (arg && /^\d+$/.test(arg)) return ctx.reply(`No model #${arg}. Send ${ctx.prefix}aimodel to see the list.`);

      const shown = (arg ? models.filter((m) => m.toLowerCase().includes(arg.toLowerCase())) : models).slice(0, MAX_LIST);
      if (!shown.length) return ctx.reply(`No ${provider} model matches "${arg}". Send ${ctx.prefix}aimodel for all.`);
      lastList.set(listKey, shown);
      const lines = [
        `🧠 *${LABELS[provider]} models*${arg ? ` matching "${arg}"` : ""} — in use: *${app.ai.model}*`,
        `Default: ${AI_DEFAULT_MODELS[provider]}`,
        "",
        ...shown.map((m, i) => `${i + 1}. ${m}${m === app.ai.model ? "  ✅" : ""}`),
      ];
      const more = (arg ? models.filter((m) => m.toLowerCase().includes(arg.toLowerCase())) : models).length - shown.length;
      if (more > 0) lines.push(`… and ${more} more (add a word to filter, e.g. ${ctx.prefix}aimodel pro)`);
      lines.push("", `Switch: ${ctx.prefix}aimodel <number or name>`);
      return ctx.reply(lines.join("\n"));
    },
  },
];
