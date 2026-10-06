"use strict";

const { probeTools } = require("../../services/tools");
const { version } = require("../../../package.json");
const cookies = require("../../services/cookies");

// How to turn on each optional capability (shown for the ones that are off).
const HOW_TO_ENABLE = {
  ffmpeg: "install ffmpeg (apt install ffmpeg), or .setvar FFMPEG_PATH <full path>",
  ytdlp: "install yt-dlp, then .setvar YTDLP_PATH ~/.local/bin/yt-dlp",
  ai: ".setai gemini <key> (or claude/openai) in private chat",
  font: "install fonts-dejavu-core or set FONT_FILE in .env",
  newsApi: ".setvar NEWSAPI_KEY <key>",
  openWeather: "not needed (.weather works without it)",
  tenor: ".setvar TENOR_KEY <key>",
  telegramBot: ".setvar TELEGRAM_BOT_TOKEN <token>",
  removeBg: ".setvar REMOVEBG_API_KEY <key>",
  remini: ".setvar REMINI_API_KEY <key>",
  githubRepo: ".setvar GITHUB_REPO owner/repo",
};

const ago = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};
const mb = (b) => `${Math.round(b / 1024 / 1024)} MB`;

function baileysVersion() {
  try {
    return require("@whiskeysockets/baileys/package.json").version;
  } catch {
    return "?";
  }
}

module.exports = {
  name: "doctor",
  aliases: ["diag", "diagnose", "status"],
  category: "owner",
  description: "Health report: connection, memory, tools (yt-dlp, ffmpeg …) checked live, and which commands are disabled and why.",
  permission: "owner",
  cooldown: 10,

  async run(ctx) {
    const { app } = ctx;
    await ctx.react("🩺");
    const live = await probeTools(ctx.config);
    const startup = app.capabilities;
    const mem = process.memoryUsage();
    const now = Date.now();

    const lines = [
      "🩺 *Bot doctor*",
      "",
      `Bot v${version} · Node ${process.version} · Baileys ${baileysVersion()}`,
      `⏱️ Up ${ago(now - app.health.startedAt)} · 🧠 ${mb(mem.rss)} RAM (heap ${mb(mem.heapUsed)})`,
      `📶 WhatsApp: ${app.health.state}${app.health.lastMessageAt ? ` · last message ${ago(now - app.health.lastMessageAt)} ago` : ""}`,
      `🔓 Mode: ${app.state.isPublic() ? "public" : "private"} · prefix ${ctx.prefix} · ${ctx.config.bot.timezone}`,
      `🤖 AI: ${app.ai ? `${app.ai.label} · ${app.ai.model}` : "off"} · 🍪 cookies: ${cookies.savedSites(ctx.config).join(", ") || "none"}`,
      `⚙️ Settings changed from chat: ${Object.keys(app.overrides || {}).join(", ") || "none"}`,
      "",
      "*Tools (checked now)*",
    ];
    let restartNeeded = false;
    for (const [name, t] of Object.entries(live)) {
      if (t.ok) {
        const fixed = startup[name] === false;
        restartNeeded ||= fixed;
        lines.push(`✅ ${name}: ${t.path}${t.version ? ` (${t.version})` : ""}${fixed ? " — found now, restart to enable" : ""}`);
      } else {
        lines.push(`❌ ${name}: ${t.problem}`);
      }
    }

    const disabled = app.commands.disabled;
    lines.push("", `*Commands*: ${app.commands.list.length} active, ${disabled.length} disabled`);
    const byMissing = new Map();
    for (const d of disabled) {
      const key = d.missing.join(" + ");
      if (!byMissing.has(key)) byMissing.set(key, []);
      byMissing.get(key).push(d.name);
    }
    for (const [missing, names] of byMissing) {
      const how = missing
        .split(" + ")
        .map((m) => HOW_TO_ENABLE[m] || m)
        .join("; ");
      lines.push(`• needs ${missing}: ${names.map((n) => ctx.prefix + n).join(", ")}\n   ↳ ${how}`);
    }
    if (restartNeeded) lines.push("", "⚠️ Some tools were installed after startup. Restart the bot to enable their commands.");
    return ctx.reply(lines.join("\n"));
  },
};
