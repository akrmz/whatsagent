"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { withTempDir, runFfmpeg, SAFE_INPUT } = require("../../core/media");
const { UserError } = require("../../core/errors");

/**
 * Animated sticker → video (or GIF file). sharp reads the animated WebP (ffmpeg can't)
 * and writes a GIF; ffmpeg then turns it into an MP4 that WhatsApp plays as a GIF.
 */

async function stickerToGif(ctx) {
  const media = ctx.findMedia({ types: ["sticker"], own: false });
  if (!media) throw new UserError(`Reply to an animated sticker with ${ctx.prefix}${ctx.commandName}`);
  const webp = await ctx.download(media, 2 * 1024 * 1024);
  const sharp = require("sharp");
  const meta = await sharp(webp, { animated: true }).metadata();
  if (!meta.pages || meta.pages < 2) throw new UserError(`That sticker isn't animated. Use ${ctx.prefix}simage to turn it into a picture.`);
  return sharp(webp, { animated: true, limitInputPixels: 64e6 }).gif().toBuffer();
}

module.exports = [
  {
    name: "tovideo",
    aliases: ["tomp4", "togifv"],
    category: "sticker",
    description: "Turns an animated sticker into a video that plays like a GIF (needs ffmpeg; without it, use .togif).",
    usage: "(reply to an animated sticker)",
    cooldown: 10,
    requires: ["ffmpeg"],
    async run(ctx) {
      const gif = await stickerToGif(ctx);
      const video = await withTempDir(ctx.config.paths.tmp, async (dir) => {
        const input = path.join(dir, "in.gif");
        const out = path.join(dir, "out.mp4");
        fs.writeFileSync(input, gif);
        // White background (stickers are transparent), even dimensions for H.264.
        await runFfmpeg(ctx.config.tools.ffmpeg, [
          ...SAFE_INPUT,
          "-i",
          input,
          "-filter_complex",
          "color=white,format=rgb24[bg];[bg][0:v]scale2ref[bg2][fg];[bg2][fg]overlay=shortest=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p",
          "-movflags",
          "+faststart",
          "-an",
          out,
        ]);
        return fs.readFileSync(out);
      });
      return ctx.reply({ video, gifPlayback: true, mimetype: "video/mp4" });
    },
  },
  {
    name: "togif",
    category: "sticker",
    description: "Turns an animated sticker into a GIF file.",
    usage: "(reply to an animated sticker)",
    cooldown: 10,
    async run(ctx) {
      const gif = await stickerToGif(ctx);
      return ctx.reply({ document: gif, mimetype: "image/gif", fileName: "sticker.gif" });
    },
  },
];
