"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { files } = require("../../services/settings");
const { getText } = require("../../core/context");

const ASSETS = path.join(__dirname, "..", "..", "..", "assets");
const MAX_BYTES = 1024 * 1024;
const EXT = { sticker: "webp", image: "jpg", video: "mp4", audio: "mp3" };

module.exports = [
  {
    name: "mention",
    category: "owner",
    description: "Turns the automatic reply on or off for messages that mention the bot in groups.",
    usage: "on | off",
    permission: "owner",
    async run(ctx) {
      const s = files.mention(ctx.state);
      const sub = (ctx.args[0] || "").toLowerCase();
      if (sub !== "on" && sub !== "off") return ctx.reply(`Mention reply is *${s.data.enabled ? "ON" : "OFF"}*. Usage: ${ctx.prefix}mention on|off`);
      s.update((d) => (d.enabled = sub === "on"));
      return ctx.reply(`✅ Mention reply ${sub === "on" ? "enabled" : "disabled"}.`);
    },
  },
  {
    name: "setmention",
    category: "owner",
    description: "Sets what the bot replies when mentioned: reply to a text, sticker, image, video or audio (max 1 MB).",
    usage: "(reply to a message)",
    permission: "owner",
    async run(ctx) {
      if (!ctx.quoted) return ctx.reply("Reply to a text, sticker, image, video or audio message.");
      const s = files.mention(ctx.state);
      const media = ctx.findMedia({ types: ["sticker", "image", "video", "audio"], own: false });
      if (!media) {
        const text = getText(ctx.quoted.message).trim();
        if (!text) return ctx.reply("Unsupported message. Reply to text, sticker, image, video or audio.");
        s.update((d) => Object.assign(d, { type: "text", text: text.slice(0, 2000), assetPath: "" }));
        return ctx.reply("✅ Mention reply text updated.");
      }
      const buffer = await ctx.download(media, MAX_BYTES);
      for (const f of fs.readdirSync(ASSETS)) if (f.startsWith("mention_custom.")) fs.rmSync(path.join(ASSETS, f), { force: true });
      const file = `mention_custom.${EXT[media.type]}`;
      fs.writeFileSync(path.join(ASSETS, file), buffer);
      s.update((d) =>
        Object.assign(d, {
          type: media.type,
          assetPath: `assets/${file}`,
          mimetype: media.type === "audio" ? media.mimetype || "audio/mpeg" : undefined,
          ptt: media.type === "audio" ? Boolean(media.content.ptt) : undefined,
          gifPlayback: media.type === "video" ? Boolean(media.content.gifPlayback) : undefined,
        }),
      );
      return ctx.reply("✅ Mention reply media updated.");
    },
  },
];
