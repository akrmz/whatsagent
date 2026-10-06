"use strict";

const groupcmds = require("../../services/groupcmds");

module.exports = {
  name: "stats",
  aliases: ["usage", "botstats"],
  category: "owner",
  description: "Shows which commands are used most, total commands run, and since when. \".stats reset\" starts counting again.",
  usage: "[reset]",
  permission: "owner",
  cooldown: 5,
  async run(ctx) {
    if ((ctx.args[0] || "").toLowerCase() === "reset") {
      groupcmds.resetStats(ctx.state);
      return ctx.reply("🧹 Usage statistics reset.");
    }
    const s = groupcmds.statsStore(ctx.state).data;
    const top = Object.entries(s.commands || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    const groups = await Promise.resolve()
      .then(() => ctx.sock.groupFetchAllParticipating())
      .then((g) => Object.keys(g || {}).length)
      .catch(() => "?");
    const days = Math.max(1, Math.round((Date.now() - (s.since || Date.now())) / 86400000));
    const lines = [
      "📊 *Usage*",
      `Since ${new Date(s.since || Date.now()).toISOString().slice(0, 10)} (${days} day(s)): *${s.total || 0}* commands, about ${Math.round((s.total || 0) / days)} a day.`,
      `Commands available: ${ctx.app.commands.list.length} · groups the bot is in: ${groups}`,
      "",
      ...(top.length ? top.map(([name, n], i) => `${i + 1}. ${ctx.prefix}${name} — ${n}`) : ["No commands used yet."]),
    ];
    return ctx.reply(lines.join("\n"));
  },
};
