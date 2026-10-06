"use strict";

const vars = require("../../services/vars");
const { toolPath } = require("../../config");
const { runVersion, explainFailure } = require("../../services/tools");
const { tryDeleteSecretMessage } = require("../../services/secrets");
const { suggest } = require("../../services/help");
const { UserError } = require("../../core/errors");

// The program must answer like the real tool, so the path can't point at a shell or interpreter.
const TOOL_CHECK = {
  YTDLP_PATH: { args: ["--version"], looksRight: /^\d{4}\.\d{2}\.\d{2}/, name: "yt-dlp" },
  FFMPEG_PATH: { args: ["-version"], looksRight: /^ffmpeg version /, name: "ffmpeg" },
};

function findSetting(name) {
  const key = String(name || "").toUpperCase().replace(/-/g, "_");
  return vars.BY_KEY.get(key) || null;
}

function unknown(ctx, name) {
  const close = suggest(String(name).toUpperCase(), new Map(vars.SETTINGS.map((s) => [s.key, { name: s.key }])));
  const hint = close.length ? `\nDid you mean: ${close.join(", ")}?` : "";
  return ctx.reply(`"${name}" is not a setting that can be changed from chat.${hint}\nSend ${ctx.prefix}vars to see them all.`);
}

/** The value in use (from chat, .env or the default). */
const currentValue = (app, key) => vars.effective(key, app.config);

/** Checks that a tool path really starts before saving it. */
async function checkTool(key, value) {
  const bin = toolPath(value);
  const check = TOOL_CHECK[key];
  const result = await runVersion(bin, check.args);
  if (!result.ok) throw new UserError(`Not saved: ${explainFailure(bin, key, result)}`);
  const first = result.output.split("\n")[0].trim();
  if (!check.looksRight.test(first)) throw new UserError(`Not saved: ${bin} runs, but it is not ${check.name}.`);
  return first.slice(0, 80);
}

module.exports = [
  {
    name: "setvar",
    aliases: ["set", "setenv"],
    category: "owner",
    description: "Changes a setting from WhatsApp — AI keys and models, bot name, prefix, API keys, limits, tool paths. Applied immediately, saved across restarts, overrides .env. Secrets only in private chat.",
    usage: "<NAME> <value>",
    examples: [".setvar BOT_NAME Akram Bot", ".setvar GEMINI_API_KEY AIza…", ".setvar MAX_VIDEO_SECONDS 900", ".setvar YTDLP_PATH ~/.local/bin/yt-dlp"],
    permission: "owner",
    cooldown: 3,
    async run(ctx) {
      const [name] = ctx.args;
      if (!name) return ctx.reply(`Usage: ${ctx.prefix}setvar <NAME> <value>\nSee all settings: ${ctx.prefix}vars`);
      const setting = findSetting(name);
      if (!setting) return unknown(ctx, name);
      const value = ctx.text.slice(name.length).trim();
      if (setting.secret && ctx.isGroup) {
        await tryDeleteSecretMessage(ctx);
        return ctx.reply("🔐 Never send keys in a group. Send it to me in a private chat. If this message is still visible, delete it and get a new key.");
      }
      if (!value) {
        return ctx.reply(`Usage: ${ctx.prefix}setvar ${setting.key} <value>\n${setting.about}${setting.example ? `\nExample: ${ctx.prefix}setvar ${setting.key} ${setting.example}` : ""}\nTo go back to .env/default: ${ctx.prefix}delvar ${setting.key}`);
      }
      if (value.length > 2000) return ctx.reply("That value is too long.");
      const version = TOOL_CHECK[setting.key] ? await checkTool(setting.key, value) : null;
      const deleted = setting.secret ? await tryDeleteSecretMessage(ctx) : false;
      const diff = await vars.apply(ctx.app, { [setting.key]: value });
      const lines = [
        `✅ ${setting.key} = ${vars.display(setting, value)}${version ? ` (${version})` : ""}`,
        setting.restart ? "" : "Active now, and kept after restarts.",
        vars.describeDiff(diff, ctx.prefix),
        setting.secret && !deleted ? "🧹 Delete your message with the key from this chat." : "",
      ];
      return ctx.reply(lines.filter(Boolean).join("\n"));
    },
  },
  {
    name: "delvar",
    aliases: ["unset", "resetvar"],
    category: "owner",
    description: "Removes a setting made with .setvar, so the value from .env (or the default) is used again.",
    usage: "<NAME>",
    examples: [".delvar PREFIX"],
    permission: "owner",
    async run(ctx) {
      const setting = findSetting(ctx.args[0]);
      if (!ctx.args[0]) return ctx.reply(`Usage: ${ctx.prefix}delvar <NAME>`);
      if (!setting) return unknown(ctx, ctx.args[0]);
      if (!Object.hasOwn(ctx.app.overrides, setting.key)) return ctx.reply(`${setting.key} was not set from chat (it comes from ${vars.sourceOf(setting.key, ctx.app.baseEnv, ctx.app.overrides)}).`);
      const diff = await vars.apply(ctx.app, { [setting.key]: null });
      const now = currentValue(ctx.app, setting.key);
      return ctx.reply([`↩️ ${setting.key} reset to ${vars.display(setting, now)} (from ${vars.sourceOf(setting.key, ctx.app.baseEnv, ctx.app.overrides)}).`, vars.describeDiff(diff, ctx.prefix)].filter(Boolean).join("\n"));
    },
  },
  {
    name: "vars",
    aliases: ["getvar", "env", "config"],
    category: "owner",
    description: "Lists the settings you can change from chat with their current values (keys are hidden) and where each comes from.",
    usage: "[NAME | ai | bot | keys | limits | tools]",
    examples: [".vars", ".vars ai", ".vars GEMINI_MODEL"],
    permission: "owner",
    async run(ctx) {
      const { app } = ctx;
      const arg = ctx.args[0];
      const one = arg && findSetting(arg);
      if (one) {
        const v = currentValue(app, one.key);
        return ctx.reply(
          [
            `*${one.key}*`,
            one.about,
            `Value: ${vars.display(one, v)}`,
            `From: ${vars.sourceOf(one.key, app.baseEnv, app.overrides)}`,
            one.restart ? "Needs a restart to take effect." : "",
            "",
            `Change: ${ctx.prefix}setvar ${one.key} ${one.secret ? "<key>" : one.example || "<value>"}`,
            `Reset: ${ctx.prefix}delvar ${one.key}`,
          ]
            .filter((l) => l !== "")
            .join("\n"),
        );
      }
      const wanted = arg ? vars.GROUPS.find((g) => g.toLowerCase().startsWith(arg.toLowerCase().replace(/s$/, "")) || (arg.toLowerCase() === "keys" && g === "API keys")) : null;
      if (arg && !wanted) return unknown(ctx, arg);
      const lines = ["⚙️ *Settings*  (✏️ = set from chat)", ""];
      for (const group of wanted ? [wanted] : vars.GROUPS) {
        lines.push(`*${group}*`);
        for (const s of vars.SETTINGS.filter((x) => x.group === group)) {
          const v = currentValue(app, s.key);
          const mark = Object.hasOwn(app.overrides, s.key) ? " ✏️" : "";
          const from = vars.sourceOf(s.key, app.baseEnv, app.overrides) === "default" && v ? " (default)" : "";
          lines.push(`• ${s.key}: ${vars.display(s, v)}${mark}${from}`);
        }
        lines.push("");
      }
      lines.push(`Change: ${ctx.prefix}setvar <NAME> <value> · Details: ${ctx.prefix}vars <NAME>`);
      lines.push(`AI shortcut: ${ctx.prefix}setai gemini <key> · ${ctx.prefix}aimodel`);
      return ctx.reply(lines.join("\n"));
    },
  },
  {
    name: "restart",
    aliases: ["reboot"],
    category: "owner",
    description: "Restarts the bot (needed for a few settings). Works when the bot runs under PM2 or Docker, which start it again.",
    permission: "owner",
    cooldown: 30,
    async run(ctx) {
      await ctx.reply("🔁 Restarting… back in a few seconds. (Under PM2/Docker it starts again automatically; with plain `npm start` it just stops.)");
      ctx.log.info("restart requested from chat");
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 1500).unref();
    },
  },
];
