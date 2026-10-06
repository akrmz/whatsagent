"use strict";

const { toAudio } = require("../../core/media");
const { UserError } = require("../../core/errors");

/**
 * Voice-changer / music effects with ffmpeg. The filter strings are fixed here; user text
 * never reaches ffmpeg. A voice note comes back as a voice note, anything else as MP3.
 */

const MAX_SECONDS = 600;

// [command, aliases, description, ffmpeg -af filter chain]
const EFFECTS = [
  ["bass", ["bassboost"], "Boosts the bass.", "bass=g=12:f=110:w=0.6,alimiter=limit=0.95"],
  ["nightcore", ["nc"], "Faster and higher (nightcore).", "aresample=44100,asetrate=55125,aresample=44100"],
  ["vaporwave", ["vapor"], "Slower and lower (vaporwave).", "aresample=44100,asetrate=35280,aresample=44100"],
  ["slow", ["slowed"], "Slows it down (same pitch).", "atempo=0.8"],
  ["fast", ["speedup"], "Speeds it up (same pitch).", "atempo=1.35"],
  ["deep", ["lowvoice"], "Deeper voice (same speed).", "aresample=44100,asetrate=35280,aresample=44100,atempo=1.25"],
  ["chipmunk", ["squirrel", "highvoice"], "Chipmunk voice (same speed).", "aresample=44100,asetrate=61740,aresample=44100,atempo=0.714"],
  ["robot", [], "Robot voice.", "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75"],
  ["echo", [], "Adds an echo.", "aecho=0.8:0.88:500:0.4"],
  ["reverse", [], "Plays it backwards.", "areverse"],
  ["8d", ["eightd"], "Slowly pans left and right (use headphones).", "apulsator=hz=0.08"],
];

function effect([name, aliases, description, filter]) {
  return {
    name,
    aliases,
    category: "audio",
    description: `${description} Reply to a voice note, song or video.`,
    usage: "(reply to audio or video)",
    cooldown: 15,
    requires: ["ffmpeg"],
    async run(ctx) {
      const media = ctx.findMedia({ types: ["audio", "video", "document"] });
      if (!media || (media.type === "document" && !/^(audio|video)\//.test(media.mimetype))) {
        return ctx.reply(`Reply to a voice note, song or video with ${ctx.prefix}${ctx.commandName}`);
      }
      if (media.seconds && media.seconds > MAX_SECONDS) throw new UserError(`That is too long; the limit is ${MAX_SECONDS / 60} minutes.`);
      await ctx.react("🎛️");
      const voice = Boolean(media.content?.ptt);
      const out = await toAudio(await ctx.download(media), {
        format: voice ? "opus" : "mp3",
        filter,
        ffmpegPath: ctx.config.tools.ffmpeg,
        tmpDir: ctx.config.paths.tmp,
        maxSeconds: MAX_SECONDS,
      });
      return ctx.reply(voice ? { audio: out.buffer, mimetype: out.mimetype, ptt: true } : { audio: out.buffer, mimetype: out.mimetype, fileName: `${name}.mp3` });
    },
  };
}

module.exports = EFFECTS.map(effect);
module.exports.EFFECTS = EFFECTS;
