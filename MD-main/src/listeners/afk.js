"use strict";

const afk = require("../services/afk");
const { parseCommand } = require("../core/context");
const { formatDuration } = require("../services/reminders");
const { LRU } = require("../core/lru");
const { at } = require("../services/targets");

// One "X is AFK" notice per chat and user every 5 minutes, so a busy group isn't spammed.
const notified = new LRU({ max: 5000, ttlMs: 5 * 60 * 1000 });

module.exports = {
  name: "afk",
  event: "message",
  phase: "pre", // before commands, so ".ping" from an AFK user also counts as "back"
  priority: 60,
  async run(ctx) {
    const { app } = ctx;
    const parsed = parseCommand(ctx.body, ctx.prefix);
    const isAfkCommand = parsed && app.commands.byName.get(parsed.name)?.name === "afk";

    if (!isAfkCommand) {
      const back = afk.clear(app, ctx.sender);
      if (back) await ctx.reply(`👋 Welcome back! You were AFK for ${formatDuration(Date.now() - back.since)}.`).catch(() => {});
    }

    const targets = new Set([...ctx.mentions, ctx.quoted?.sender].filter(Boolean));
    for (const jid of targets) {
      const status = afk.get(app, jid);
      if (!status || app.identity.aliases(jid).includes(ctx.sender)) continue;
      const key = `${ctx.chatId}|${status.jid}`;
      if (notified.get(key)) continue;
      notified.set(key, true);
      const reason = status.reason ? `\n📝 ${status.reason}` : "";
      await ctx
        .reply({ text: `💤 ${at(status.jid)} is AFK (${formatDuration(Date.now() - status.since)} ago).${reason}`, mentions: [status.jid] })
        .catch(() => {});
    }
  },
};
