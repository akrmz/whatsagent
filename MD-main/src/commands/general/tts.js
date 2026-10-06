"use strict";

const { getBuffer } = require("../../core/http");
const { UserError } = require("../../core/errors");
const { toAudio } = require("../../core/media");

const MAX_CHARS = 1000;
const CHUNK = 180; // Google TTS accepts ~200 characters per request

// Language guessed from the script when no code is given.
const SCRIPTS = [
  [/\p{Script=Arabic}/u, "ar"],
  [/\p{Script=Cyrillic}/u, "ru"],
  [/\p{Script=Hebrew}/u, "iw"],
  [/\p{Script=Devanagari}/u, "hi"],
  [/\p{Script=Hangul}/u, "ko"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
  [/\p{Script=Han}/u, "zh-CN"],
  [/\p{Script=Thai}/u, "th"],
  [/\p{Script=Greek}/u, "el"],
];
// "fr: Bonjour" — the colon keeps "hi there" from being read as Hindi.
const LANG_RE = /^([a-z]{2,3}(?:-[a-z]{2,4})?):\s*/i;

function chunks(text) {
  const out = [];
  let rest = text.trim();
  while (rest.length > CHUNK) {
    let cut = rest.lastIndexOf(" ", CHUNK);
    if (cut < 50) cut = CHUNK;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** ".tts fr: bonjour" → { lang: "fr", text: "bonjour" }; ".tts مرحبا" → ar. */
function pickLanguage(text) {
  const m = text.match(LANG_RE);
  if (m) return { lang: m[1].toLowerCase(), text: text.slice(m[0].length).trim() };
  const found = SCRIPTS.find(([re]) => re.test(text));
  return { lang: found ? found[1] : "en", text };
}

module.exports = {
  name: "tts",
  aliases: ["say", "speak"],
  category: "general",
  description: "Turns text into a voice note. Arabic and other scripts are detected automatically; for other languages start with a code and a colon (fr:, es:, de:, tr: …).",
  usage: "[lang:] <text>",
  examples: [".tts Good morning everyone", ".tts صباح الخير", ".tts fr: Bonjour tout le monde"],
  cooldown: 10,
  externalService: "translate.google.com",
  pickLanguage,

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}tts [lang:] <text>`);
    const { lang, text } = pickLanguage(ctx.text);
    if (!text) return ctx.reply(`Usage: ${ctx.prefix}tts ${lang}: <text>`);
    if (text.length > MAX_CHARS) throw new UserError(`Text is too long (max ${MAX_CHARS} characters).`);
    const parts = [];
    for (const [i, part] of chunks(text).entries()) {
      const qs = new URLSearchParams({ ie: "UTF-8", q: part, tl: lang, client: "tw-ob", total: "1", idx: String(i), textlen: String(part.length) });
      let buffer;
      try {
        ({ buffer } = await getBuffer(`https://translate.google.com/translate_tts?${qs}`, { maxBytes: 2 * 1024 * 1024 }));
      } catch (err) {
        if (err.status === 400 || err.status === 404) throw new UserError(`"${lang}" is not a language Google can speak.`);
        throw err;
      }
      parts.push(buffer);
    }
    const mp3 = Buffer.concat(parts);
    // A real voice note (push-to-talk) when ffmpeg can convert it; otherwise an MP3.
    if (ctx.app.capabilities.ffmpeg) {
      const voice = await toAudio(mp3, { format: "opus", ffmpegPath: ctx.config.tools.ffmpeg, tmpDir: ctx.config.paths.tmp });
      return ctx.reply({ audio: voice.buffer, mimetype: voice.mimetype, ptt: true });
    }
    return ctx.reply({ audio: mp3, mimetype: "audio/mpeg" });
  },
};
