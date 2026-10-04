"use strict";

/** Sticker settings from config (pack name, author, ffmpeg path, temp dir). */
function stickerOptions(ctx) {
  return {
    pack: ctx.config.bot.stickerPack,
    author: ctx.config.bot.stickerAuthor,
    ffmpegPath: ctx.config.tools.ffmpeg,
    tmpDir: ctx.config.paths.tmp,
  };
}

module.exports = { stickerOptions };
