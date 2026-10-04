"use strict";

const { createUpdater } = require("../../services/updater");

let updater;
const short = (sha) => String(sha || "").slice(0, 7);

function botLines(s) {
  if (!s.supported) return [`🤖 *Bot:* ${s.reason}`];
  const head = `${short(s.current)} (v${s.currentVersion})`;
  if (s.ahead && !s.behind) return [`🤖 *Bot:* ${head} has ${s.ahead} commit(s) that are not on GitHub.`];
  if (!s.behind) return [`🤖 *Bot:* ✅ up to date — ${head}`];
  return [
    `🤖 *Bot:* ⬆️ update available — ${s.behind} new commit(s)`,
    `   ${head} → ${short(s.latest)} (v${s.latestVersion})`,
    ...s.changes.map((c) => `   • ${c}`),
    s.dirty ? "   ⚠️ The server has local code changes; updating is blocked until they are removed." : null,
  ].filter(Boolean);
}

function ytdlpLines(y) {
  if (!y.installed) return ["🎬 *yt-dlp:* not installed"];
  if (!y.latest) return [`🎬 *yt-dlp:* ${y.current} (could not check GitHub for the latest nightly)`];
  if (!y.behind) return [`🎬 *yt-dlp:* ✅ latest nightly — ${y.current}`];
  return [`🎬 *yt-dlp:* ⬆️ ${y.current} → nightly ${y.latest}`];
}

module.exports = {
  name: "update",
  category: "owner",
  description:
    "Checks GitHub for a newer version of the bot and of yt-dlp (nightly). '.update now' installs them: the bot is fast-forwarded from your repository, validated, rolled back if the check fails, and restarted.",
  usage: "[now]",
  examples: [".update", ".update now"],
  permission: "owner",
  cooldown: 30,

  async run(ctx) {
    updater ||= createUpdater({ config: ctx.config, log: ctx.log });
    const apply = (ctx.args[0] || "").toLowerCase() === "now";
    if (ctx.args[0] && !apply) return ctx.reply(`Usage: ${ctx.prefix}update  (check)  or  ${ctx.prefix}update now  (install)`);

    await ctx.react("🔄");
    return updater.exclusive(async () => {
      const [bot, ytdlp] = await Promise.all([
        updater.botStatus().catch((err) => ({ supported: false, reason: err.message })),
        updater.ytdlpStatus(),
      ]);

      if (!apply) {
        const canUpdate = (bot.supported && bot.behind && !bot.dirty && !bot.ahead) || ytdlp.behind;
        const lines = [...botLines(bot), ...ytdlpLines(ytdlp)];
        if (canUpdate) lines.push("", `Send *${ctx.prefix}update now* to install.`);
        return ctx.reply(lines.join("\n"));
      }

      const report = [];
      if (ytdlp.behind) {
        try {
          report.push(`🎬 yt-dlp updated to ${await updater.updateYtdlp()}`);
        } catch (err) {
          report.push(`🎬 ❌ ${err.message}`);
        }
      } else {
        report.push(...ytdlpLines(ytdlp));
      }

      if (!bot.supported || !bot.behind) {
        report.push(...botLines(bot));
        return ctx.reply(report.join("\n"));
      }
      try {
        const result = await updater.updateBot(bot);
        report.push(
          `🤖 ✅ Bot updated ${short(result.from)} → ${short(result.to)} (v${bot.latestVersion})${result.depsChanged ? ", dependencies reinstalled" : ""}.`,
          "Restarting now. If the bot doesn't come back within a minute, check that it runs under PM2 or Docker.",
        );
        await ctx.reply(report.join("\n"));
        ctx.log.info({ from: result.from, to: result.to }, "updated; restarting");
        // Graceful shutdown (state is flushed); PM2/Docker start the new code.
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 1500).unref();
        return undefined;
      } catch (err) {
        report.push(`🤖 ❌ ${err.message}`);
        return ctx.reply(report.join("\n"));
      }
    });
  },
};
