"use strict";

/**
 * Fully worked example command: measures reply latency and shows uptime and version.
 * Walkthrough in docs/ADDING_FEATURES.md.
 */

const { version } = require("../../../package.json");

function formatUptime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const parts = [
    [Math.floor(s / 86400), "d"],
    [Math.floor((s % 86400) / 3600), "h"],
    [Math.floor((s % 3600) / 60), "m"],
    [s % 60, "s"],
  ].filter(([n], i, all) => n > 0 || i === all.length - 1);
  return parts.map(([n, unit]) => `${n}${unit}`).join(" ");
}

module.exports = {
  name: "ping",
  category: "general",
  description: "Checks that the bot is online and shows response time, uptime and version.",
  examples: [".ping"],
  cooldown: 5,

  async run(ctx) {
    const started = Date.now();
    await ctx.reply("Pong!");
    const latency = Date.now() - started;
    await ctx.reply(
      [`🏓 *${ctx.config.bot.name}*`, `Response: ${latency} ms`, `Uptime: ${formatUptime(process.uptime())}`, `Version: v${version}`].join("\n"),
    );
  },

  // Exported for unit tests.
  formatUptime,
};
