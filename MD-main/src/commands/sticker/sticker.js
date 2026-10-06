"use strict";

const { toSticker, toPng, addStickerExif, sniff } = require("../../core/media");
const { UserError } = require("../../core/errors");
const { stickerOptions } = require("../../services/stickers");

async function makeSticker(ctx, { crop }) {
  const media = ctx.findMedia({ types: ["image", "video", "sticker", "document"] });
  if (!media) {
    return ctx.reply(`Send or reply to an image, GIF or short video with ${ctx.prefix}${ctx.commandName}.`);
  }
  if (media.type === "document" && !/^(image|video)\//.test(media.mimetype)) {
    throw new UserError("Only image and video files can become stickers.");
  }
  const buffer = await ctx.download(media);
  const kind = sniff(buffer);
  const animated = media.type === "video" || /gif|video/.test(media.mimetype) || kind === "gif" || kind === "mp4" || kind === "webm";
  if (animated && !ctx.app.capabilities.ffmpeg) throw new UserError("ffmpeg is not installed on the server, so GIFs and videos can't become stickers (pictures still work).");
  // ".sticker My Pack | Me" sets the pack name and author for this sticker.
  const [pack, author] = ctx.text ? ctx.text.split("|").map((x) => x.trim().slice(0, 60)) : [];
  const options = { ...stickerOptions(ctx), ...(pack ? { pack } : {}), ...(author !== undefined ? { author } : {}) };
  const sticker = await toSticker(buffer, { ...options, animated, crop });
  return ctx.reply({ sticker });
}

module.exports = [
  {
    name: "sticker",
    aliases: ["s"],
    category: "sticker",
    description: "Turns an image, GIF or short video (first 6 s) into a sticker. Optionally give a pack name and author. Pictures work without ffmpeg.",
    usage: "[pack | author] (send or reply to media)",
    examples: [".sticker", ".sticker My Pack | Akram"],
    cooldown: 5,
    run: (ctx) => makeSticker(ctx, { crop: false }),
  },
  {
    name: "crop",
    category: "sticker",
    description: "Like .sticker but crops the media to a square.",
    usage: "[pack | author] (send or reply to media)",
    cooldown: 5,
    run: (ctx) => makeSticker(ctx, { crop: true }),
  },
  {
    name: "simage",
    category: "sticker",
    description: "Converts the sticker you reply to into a picture.",
    usage: "(reply to a sticker)",
    cooldown: 5,
    async run(ctx) {
      const media = ctx.findMedia({ types: ["sticker"], own: false });
      if (!media) return ctx.reply(`Reply to a sticker with ${ctx.prefix}simage`);
      const image = await toPng(await ctx.download(media, 5 * 1024 * 1024));
      return ctx.reply({ image, caption: "Here is the image." });
    },
  },
  {
    name: "take",
    aliases: ["steal"],
    category: "sticker",
    description: "Re-labels the sticker you reply to with your own pack name.",
    usage: "<pack name> (reply to a sticker)",
    examples: [".take My Pack"],
    cooldown: 5,
    async run(ctx) {
      const media = ctx.findMedia({ types: ["sticker"], own: false });
      if (!media) return ctx.reply(`❌ Reply to a sticker with ${ctx.prefix}take <packname>`);
      const buffer = await ctx.download(media, 2 * 1024 * 1024);
      const sticker = await addStickerExif(buffer, { pack: (ctx.text || ctx.config.bot.stickerPack).slice(0, 60), author: ctx.config.bot.stickerAuthor });
      return ctx.reply({ sticker });
    },
  },
];
