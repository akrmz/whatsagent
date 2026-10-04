"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { withTempDir, runFfmpeg, addStickerExif } = require("../../core/media");
const { UserError } = require("../../core/errors");

/** Escapes a file path for use inside an ffmpeg filter argument. */
const filterPath = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

module.exports = {
  name: "attp",
  category: "sticker",
  description: "Makes an animated sticker of your text blinking in colours.",
  usage: "<text>",
  examples: [".attp hello"],
  cooldown: 10,
  requires: ["ffmpeg", "font"],

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}attp <text>`);
    if (ctx.text.length > 60) throw new UserError("Text is too long (max 60 characters).");
    const { tools, paths, bot } = ctx.config;
    const webp = await withTempDir(paths.tmp, async (dir) => {
      // The text goes through a file, never through the filter string, so it cannot inject ffmpeg options.
      const textFile = path.join(dir, "text.txt");
      fs.writeFileSync(textFile, ctx.text);
      const out = path.join(dir, "out.webp");
      const common = `fontfile='${filterPath(tools.fontFile)}':textfile='${filterPath(textFile)}':fontsize=56:borderw=2:bordercolor=black@0.6:x=(w-text_w)/2:y=(h-text_h)/2`;
      const vf = [
        `drawtext=${common}:fontcolor=red:enable='lt(mod(t\\,0.3)\\,0.1)'`,
        `drawtext=${common}:fontcolor=blue:enable='between(mod(t\\,0.3)\\,0.1\\,0.2)'`,
        `drawtext=${common}:fontcolor=green:enable='gte(mod(t\\,0.3)\\,0.2)'`,
      ].join(",");
      await runFfmpeg(tools.ffmpeg, [
        "-f", "lavfi", "-i", "color=c=black@0.0:s=512x512:d=1.8:r=20,format=rgba",
        "-vf", vf, "-c:v", "libwebp", "-loop", "0", "-quality", "60", "-pix_fmt", "yuva420p", out,
      ]);
      return fs.readFileSync(out);
    });
    const sticker = await addStickerExif(webp, { pack: bot.stickerPack, author: bot.stickerAuthor });
    return ctx.reply({ sticker });
  },
};
