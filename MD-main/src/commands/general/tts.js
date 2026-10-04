"use strict";

const { getBuffer } = require("../../core/http");
const { UserError } = require("../../core/errors");

const MAX_CHARS = 1000;
const CHUNK = 180; // Google TTS accepts ~200 characters per request

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

module.exports = {
  name: "tts",
  category: "general",
  description: "Turns text into an English voice note.",
  usage: "<text>",
  examples: [".tts Good morning everyone"],
  cooldown: 10,
  externalService: "translate.google.com",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}tts <text>`);
    if (ctx.text.length > MAX_CHARS) throw new UserError(`Text is too long (max ${MAX_CHARS} characters).`);
    const parts = [];
    for (const [i, part] of chunks(ctx.text).entries()) {
      const qs = new URLSearchParams({ ie: "UTF-8", q: part, tl: "en", client: "tw-ob", total: "1", idx: String(i), textlen: String(part.length) });
      const { buffer } = await getBuffer(`https://translate.google.com/translate_tts?${qs}`, { maxBytes: 2 * 1024 * 1024 });
      parts.push(buffer);
    }
    return ctx.reply({ audio: Buffer.concat(parts), mimetype: "audio/mpeg" });
  },
};
