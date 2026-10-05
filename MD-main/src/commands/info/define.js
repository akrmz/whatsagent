"use strict";

const { getJson, HttpError } = require("../../core/http");

module.exports = {
  name: "define",
  aliases: ["dict", "dictionary", "meaning"],
  category: "info",
  description: "Looks up an English word: pronunciation, meanings, examples and synonyms.",
  usage: "<word>",
  examples: [".define serendipity"],
  cooldown: 5,
  externalService: "dictionaryapi.dev",

  async run(ctx) {
    const word = ctx.text.trim().slice(0, 60);
    if (!word) return ctx.reply(`Usage: ${ctx.prefix}define <word>`);
    let entries;
    try {
      entries = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeoutMs: 15000 });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return ctx.reply(`No definition found for "${word}".`);
      throw err;
    }
    const entry = entries?.[0];
    if (!entry) return ctx.reply(`No definition found for "${word}".`);
    const lines = [`📖 *${entry.word}*${entry.phonetic ? `  ${entry.phonetic}` : ""}`];
    const synonyms = new Set();
    for (const meaning of (entry.meanings || []).slice(0, 4)) {
      lines.push("", `_${meaning.partOfSpeech}_`);
      (meaning.definitions || []).slice(0, 3).forEach((d, i) => {
        lines.push(`${i + 1}. ${d.definition}`);
        if (d.example) lines.push(`   “${d.example}”`);
      });
      for (const s of meaning.synonyms || []) synonyms.add(s);
    }
    if (synonyms.size) lines.push("", `Synonyms: ${[...synonyms].slice(0, 8).join(", ")}`);
    return ctx.reply(lines.join("\n"));
  },
};
