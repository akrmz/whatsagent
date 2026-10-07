"use strict";

const backup = require("../../services/backup");
const photobackup = require("../../services/photobackup");
const { version } = require("../../../package.json");

/** ".restore" on a photos archive: shows what it would restore, then does it with "confirm". */
async function restorePhotos(ctx, buffer) {
  const skippedText = (s) => (s.length ? `\nSkipped ${s.length}:\n${s.slice(0, 10).join("\n")}${s.length > 10 ? "\n…" : ""}` : "");
  if (!/^confirm$/i.test(ctx.args[0] || "")) {
    const { ok, skipped } = photobackup.inspect(ctx.state, buffer);
    return ctx.reply(`📷 Photos backup: ${ok.length} photo(s) for ${new Set(ok.map((p) => p.id)).size} listing(s) can be restored (existing photos with the same numbers are replaced).${skippedText(skipped)}\n\nTo go ahead, reply to the file again with *${ctx.prefix}restore confirm*`);
  }
  const r = photobackup.restore(ctx.state, ctx.config, buffer);
  return ctx.reply(`✅ Restored ${r.written} photo(s) of ${r.listings} listing(s).${skippedText(r.skipped)}`);
}

module.exports = [
  {
    name: "backup",
    category: "owner",
    description:
      "Sends you a backup file of all bot settings and lists (mode, sudo, bans, group settings, notes, reminders, levels, listings, clients …) to restore later with .restore. \".backup full\" also includes API keys set from chat and saved cookies; \".backup photos\" sends the listing photos as a .tar.gz. The WhatsApp session is never included.",
    usage: "[full | photos]",
    examples: [".backup", ".backup full", ".backup photos"],
    permission: "owner",
    privateOnly: true,
    cooldown: 30,
    async run(ctx) {
      const date = new Date().toISOString().slice(0, 10);
      if (/^photos?$/i.test(ctx.args[0] || "")) {
        await ctx.react("📦");
        const p = photobackup.create(ctx.state, ctx.config);
        return ctx.reply({
          document: p.buffer,
          mimetype: "application/gzip",
          fileName: `listing-photos-${date}.tar.gz`,
          caption: `📷 ${p.count} photo(s) of ${p.listings} listing(s), ${(p.buffer.length / 1048576).toFixed(1)} MB.\nRestore after the listings (.restore of the normal backup first): reply to this file with ${ctx.prefix}restore`,
        });
      }
      const full = /^full$/i.test(ctx.args[0] || "");
      const data = backup.create(ctx.app, { full, version });
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
      const archive = /gzip|x-tar/.test(doc.mimetype || "") || /\.t(ar\.)?gz$/i.test(doc.content?.fileName || "");
      const buffer = await ctx.download(doc, (archive ? 100 : 20) * 1024 * 1024);
      if (photobackup.isArchive(buffer)) return restorePhotos(ctx, buffer);
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
