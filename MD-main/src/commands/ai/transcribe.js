"use strict";

const usage = require("../../services/aiusage");
const { toAudio } = require("../../core/media");
const { UserError } = require("../../core/errors");

const MAX_SECONDS = 15 * 60;

module.exports = {
  name: "transcribe",
  aliases: ["stt", "totext", "voice2text"],
  category: "ai",
  description: "Writes out what is said in a voice note, audio or video (any language). Add \"translate <language>\" to translate it too.",
  usage: "[translate <language>] (reply to a voice note)",
  examples: ["(reply to a voice note) .transcribe", "(reply to a voice note) .stt translate english"],
  cooldown: 15,
  requires: ["aiAudio"],
  externalService: "Google Gemini or OpenAI (the audio is sent)",

  async run(ctx) {
    const media = ctx.findMedia({ types: ["audio", "video", "document"] });
    if (!media || (media.type === "document" && !/^(audio|video)\//.test(media.mimetype))) {
      return ctx.reply(`Reply to a voice note, audio or video with ${ctx.prefix}${ctx.commandName}`);
    }
    if (media.seconds && media.seconds > MAX_SECONDS) throw new UserError("That is too long; the limit is 15 minutes.");
    const translateTo = (ctx.text.match(/^(?:translate|tr)\s+(.{2,30})$/i) || [])[1];
    usage.takeQuota(ctx, translateTo ? 2 : 1);
    await ctx.react("✍️");

    // Gemini allows 20 MB per request and base64 adds a third: the audio sent must stay
    // under 14 MB. Videos may be larger, because only their audio track is sent.
    const isVideo = media.type === "video" || /^video\//.test(media.mimetype);
    let buffer = await ctx.download(media, (isVideo ? 50 : 14) * 1024 * 1024);
    const ffmpeg = ctx.app.capabilities.ffmpeg;
    const toMp3 = ffmpeg
      ? async (b) => (await toAudio(b, { format: "mp3", ffmpegPath: ctx.config.tools.ffmpeg, tmpDir: ctx.config.paths.tmp, maxSeconds: MAX_SECONDS })).buffer
      : null;
    let mimetype = media.mimetype;
    // Videos are sent as their audio track (much smaller); needs ffmpeg.
    if (isVideo) {
      if (!toMp3) throw new UserError("ffmpeg is not installed on the server, so videos can't be transcribed (voice notes still work).");
      buffer = await toMp3(buffer);
      mimetype = "audio/mpeg";
      if (buffer.length > 14 * 1024 * 1024) throw new UserError("The audio of that video is too long to transcribe.");
    }
    const text = await ctx.app.media.transcribe(buffer, { mimetype, toMp3 });
    if (!text || /^\[no speech\]$/i.test(text)) return ctx.reply("I couldn't hear any speech in that.");
    if (!translateTo) return ctx.reply(`✍️ ${text}`);
    if (!ctx.app.ai) return ctx.reply(`✍️ ${text}\n\n(Translation needs the AI to be set up: ${ctx.prefix}setai)`);
    const translated = await ctx.app.ai.ask(`Translate this into ${translateTo}. Output only the translation.\n\n"""${text}"""`, {
      system: "You are a precise translator.",
      maxChars: 20000,
    });
    return ctx.reply(`✍️ ${text}\n\n🌐 *${translateTo}*\n${translated}`);
  },
};
