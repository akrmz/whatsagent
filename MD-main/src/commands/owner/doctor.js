"use strict";

const { probeTools } = require("../../services/tools");
const { version } = require("../../../package.json");

// How to turn on each optional capability (shown for the ones that are off).
const HOW_TO_ENABLE = {
  ffmpeg: "install ffmpeg (apt install ffmpeg) or set FFMPEG_PATH",
  ytdlp: "install yt-dlp and set YTDLP_PATH to its full path",
  ai: "set ANTHROPIC_API_KEY",
  font: "install fonts-dejavu-core or set FONT_FILE",
  newsApi: "set NEWSAPI_KEY",
  openWeather: "set OPENWEATHER_KEY (optional; .weather works without it)",
  tenor: "set TENOR_KEY",
  telegramBot: "set TELEGRAM_BOT_TOKEN",
  removeBg: "set REMOVEBG_API_KEY",
  remini: "set REMINI_API_KEY",
  githubRepo: "set GITHUB_REPO",
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
