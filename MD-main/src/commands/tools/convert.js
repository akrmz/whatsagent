"use strict";

const { toAudio } = require("../../core/media");

const isAudioDoc = (m) => m.type === "document" && /^(audio|video)\//.test(m.mimetype);

function converter(format) {
  return async (ctx) => {
    const media = ctx.findMedia({ types: ["video", "audio", "document"] });
    if (!media || (media.type === "document" && !isAudioDoc(media))) {
      return ctx.reply(`Send or reply to a video, voice note or audio file with ${ctx.prefix}${ctx.commandName}`);
    }
    await ctx.react("🎧");
    const input = await ctx.download(media);
    const { buffer, mimetype } = await toAudio(input, {
      format,
      ffmpegPath: ctx.config.tools.ffmpeg,
      tmpDir: ctx.config.paths.tmp,
      maxSeconds: ctx.config.limits.videoSeconds,
    });
    if (format === "opus") return ctx.reply({ audio: buffer, mimetype, ptt: true });
    return ctx.reply({ audio: buffer, mimetype, fileName: "audio.mp3" });
  };
}

const base = { category: "tools", cooldown: 15, requires: ["ffmpeg"], usage: "(reply to a video or audio)" };

module.exports = [
  {
    ...base,
    name: "toaudio",
    aliases: ["tomp3", "mp3convert"],
    description: "Extracts the sound of a video (or converts a voice note/audio file) to an MP3 you can play or save.",
    run: converter("mp3"),
  },
  {
    ...base,
    name: "tovn",
    aliases: ["toptt", "tovoice"],
    description: "Turns a video, song or audio file into a WhatsApp voice note.",
    run: converter("opus"),
  },
];
