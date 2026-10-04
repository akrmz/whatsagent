"use strict";

const { getJson } = require("../../core/http");
const { getText } = require("../../core/context");

const LANG_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;
const USAGE = (p) =>
  `*TRANSLATOR*\n\n1. Reply to a message with: ${p}translate <lang>\n2. Or: ${p}translate <text> <lang>\n\nExamples:\n${p}translate hello fr\n${p}trt good morning ar\n\nCodes: en, ar, fr, es, de, it, pt, ru, ja, ko, zh, hi …`;

async function google(text, lang) {
  const qs = new URLSearchParams({ client: "gtx", sl: "auto", tl: lang, dt: "t", q: text });
  const data = await getJson(`https://translate.googleapis.com/translate_a/single?${qs}`);
  const out = (data?.[0] || []).map((seg) => seg?.[0] || "").join("");
  return out || null;
}

async function myMemory(text, lang) {
  const qs = new URLSearchParams({ q: text, langpair: `auto|${lang}` });
  const data = await getJson(`https://api.mymemory.translated.net/get?${qs}`);
  return data?.responseData?.translatedText || null;
}

module.exports = {
  name: "translate",
  aliases: ["trt"],
  category: "general",
  description: "Translates text, or the message you reply to, into another language.",
  usage: "<text> <lang>  |  (reply) <lang>",
  examples: [".translate hello fr", ".trt ar  (as a reply)"],
  cooldown: 5,
  externalService: "translate.googleapis.com, mymemory.translated.net",

  async run(ctx) {
    let text;
    let lang;
    const quotedText = ctx.quoted ? getText(ctx.quoted.message) : "";
    if (quotedText) {
      text = quotedText;
      lang = ctx.args[0];
    } else {
      if (ctx.args.length < 2) return ctx.reply(USAGE(ctx.prefix));
      lang = ctx.args[ctx.args.length - 1];
      text = ctx.args.slice(0, -1).join(" ");
    }
    if (!lang || !LANG_RE.test(lang)) return ctx.reply(USAGE(ctx.prefix));
    text = text.slice(0, 2000);
    let result = null;
    try {
      result = await google(text, lang.toLowerCase());
    } catch {
      /* fall back */
    }
    if (!result) result = await myMemory(text, lang.toLowerCase());
    return ctx.reply(result || "❌ Translation failed. Try again later.");
  },
};
