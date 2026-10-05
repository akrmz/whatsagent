"use strict";

const { getJson, HttpError } = require("../../core/http");

const LANG = /^([a-z]{2,3}):\s*/i;

async function lookup(lang, query) {
  const base = `https://${lang}.wikipedia.org`;
  const qs = new URLSearchParams({ q: query, limit: "1" });
  const found = await getJson(`${base}/w/rest.php/v1/search/title?${qs}`, { timeoutMs: 15000 });
  const key = found.pages?.[0]?.key;
  if (!key) return null;
  try {
    return await getJson(`${base}/api/rest_v1/page/summary/${encodeURIComponent(key)}`, { timeoutMs: 15000 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

module.exports = {
  name: "wiki",
  aliases: ["wikipedia"],
  category: "info",
  description: "Shows the Wikipedia summary of a topic. Start with a language code for other Wikipedias (ar:, fr:, es: …).",
  usage: "[lang:] <topic>",
  examples: [".wiki Great Pyramid of Giza", ".wiki ar: القاهرة"],
  cooldown: 5,
  externalService: "wikipedia.org",

  async run(ctx) {
    let query = ctx.text.slice(0, 200);
    let lang = "en";
    const m = query.match(LANG);
    if (m) {
      lang = m[1].toLowerCase();
      query = query.slice(m[0].length);
    }
    if (!query) return ctx.reply(`Usage: ${ctx.prefix}wiki <topic>, e.g. ${ctx.prefix}wiki Nile`);
    await ctx.react("🔎");
    let page;
    try {
      page = await lookup(lang, query);
    } catch (err) {
      // An unknown language code means the host does not exist.
      if (m && err?.code === "ENOTFOUND") return ctx.reply(`"${lang}" is not a Wikipedia language code.`);
      throw err;
    }
    if (!page?.extract) return ctx.reply(`Nothing found on Wikipedia for "${query}".`);
    const text = page.extract.length > 1500 ? `${page.extract.slice(0, 1500)}…` : page.extract;
    const link = page.content_urls?.desktop?.page || "";
    return ctx.reply(`📚 *${page.title}*${page.description ? `\n_${page.description}_` : ""}\n\n${text}${link ? `\n\n🔗 ${link}` : ""}`);
  },
};
