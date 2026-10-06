"use strict";

const backup = require("../../services/backup");
const { version } = require("../../../package.json");

module.exports = [
  {
    name: "backup",
    category: "owner",
    description:
      "Sends you a backup file of all bot settings and lists (mode, sudo, bans, group settings, notes, reminders, levels …) to restore later with .restore. \".backup full\" also includes API keys set from chat and saved cookies. The WhatsApp session is never included.",
    usage: "[full]",
    examples: [".backup", ".backup full"],
    permission: "owner",
    privateOnly: true,
    cooldown: 30,
    async run(ctx) {
      const full = /^full$/i.test(ctx.args[0] || "");
      const data = backup.create(ctx.app, { full, version });
      const date = new Date().toISOString().slice(0, 10);
      const files = Object.keys(data.files).length;
      return ctx.reply({
        document: Buffer.from(JSON.stringify(data, null, 1)),
        mimetype: "application/json",
        fileName: `bot-backup${full ? "-full" : ""}-${date}.json`,
        caption: `💾 Backup of ${files} file(s), v${version}.${full ? "\n⚠️ Contains API keys and cookies: keep it private." : ""}\nRestore: reply to this file with ${ctx.prefix}restore`,
      });
    },
  },
  {
    name: "restore",
    category: "owner",
    description: "Restores a backup made with .backup (reply to the file). Lists and settings in it replace the current ones; anything not in the backup is left alone.",
    usage: "(reply to a backup file) [confirm]",
    permission: "owner",
    privateOnly: true,
    cooldown: 10,
    async run(ctx) {
      const doc = ctx.findMedia({ types: ["document"] });
      if (!doc) return ctx.reply(`Reply to a backup file (made with ${ctx.prefix}backup) with ${ctx.prefix}restore`);
      const buffer = await ctx.download(doc, 20 * 1024 * 1024);
      const { backup: b, stores, cookieSites, overrides } = backup.inspect(buffer);
      const summary = [
        `Backup from ${String(b.created || "?").slice(0, 16).replace("T", " ")}${b.version ? ` (v${b.version})` : ""}:`,
        `• ${stores.length} list/setting file(s): ${stores.map(([n]) => n).join(", ") || "none"}`,
        overrides ? `• ${Object.keys(overrides).length} chat setting(s) incl. keys` : "",
        cookieSites.length ? `• cookies for ${cookieSites.map(([s]) => s).join(", ")}` : "",
      ].filter(Boolean);
      if (!/^confirm$/i.test(ctx.args[0] || "")) {
        return ctx.reply(`${summary.join("\n")}\n\nThis replaces those current lists and settings. To go ahead, reply to the file again with *${ctx.prefix}restore confirm*`);
      }
      const done = await backup.restore(ctx.app, buffer);
      return ctx.reply(`✅ Restored ${done.stores.length} file(s)${done.settings.length ? `, ${done.settings.length} setting(s)` : ""}${done.cookies.length ? `, cookies for ${done.cookies.join(", ")}` : ""}. Active now.`);
    },
  },
];
