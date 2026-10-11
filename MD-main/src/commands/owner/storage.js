"use strict";

const storage = require("../../services/storage");

module.exports = {
  name: "storage",
  aliases: ["disk", "space"],
  category: "owner",
  description:
    "Where the server's disk goes: listing photos and videos, watermarked copies, drafts, sellers' photos, the data files, temporary files and extra numbers, and the free space. “clean” shows what can go without losing anything that matters, and “clean confirm” removes it: watermarked copies (made again when needed), the extra photos and the videos of units sold or rented more than 90 days ago (their first photo stays), and temporary files older than a day. Owner only.",
  usage: "[clean [confirm]]",
  examples: [".storage", ".storage clean", ".storage clean confirm"],
  permission: "owner",
  cooldown: 10,
  async run(ctx) {
    const p = ctx.prefix;
    const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
    if (sub === "clean" || sub === "تنظيف") {
      if (arg !== "confirm") {
        const plan = storage.plan(ctx.app);
        if (!plan.files.length) return ctx.reply("✅ Nothing to clean: no watermarked copies, no units gone for 90+ days with extra photos or videos, no old temporary files.");
        return ctx.reply(
          `🧹 *Can be cleaned:* ${plan.files.length} file(s), ${storage.mb(plan.bytes)}${plan.listings.length ? `\n• units sold or rented 90+ days ago (their first photo stays): ${plan.listings.map((id) => `#${id}`).join("، ")}` : ""}\n• watermarked copies and old temporary files\n\nGo ahead: ${p}storage clean confirm`,
        );
      }
      const done = storage.clean(ctx.app);
      return ctx.reply(`🧹 Removed ${done.files.length} file(s), ${storage.mb(done.bytes)}${done.listings.length ? ` (${done.listings.length} sold/rented unit(s) keep their first photo)` : ""}.`);
    }
    const r = storage.report(ctx.app);
    const total = r.parts.reduce((a, x) => a + x.bytes, 0);
    const lines = r.parts.filter((x) => x.files).map((x) => `${x.name}: ${storage.mb(x.bytes)} (${x.files})`);
    return ctx.reply(
      [
        `💾 *Storage* — ${storage.mb(total)} used by the bot${r.free !== null ? ` · ${storage.mb(r.free)} free on the disk` : ""}`,
        "",
        ...(lines.length ? lines : ["Nothing stored yet."]),
        r.cleanable.files.length ? `\n🧹 ${storage.mb(r.cleanable.bytes)} can be cleaned without losing anything that matters: ${p}storage clean` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
};
