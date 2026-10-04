"use strict";

const { getJson } = require("../../core/http");

module.exports = {
  name: "news",
  category: "general",
  description: "Shows the top 5 US headlines.",
  cooldown: 30,
  requires: ["newsApi"],
  externalService: "newsapi.org",

  async run(ctx) {
    const data = await getJson("https://newsapi.org/v2/top-headlines?country=us&pageSize=5", {
      headers: { "x-api-key": ctx.config.keys.newsApi },
    });
    const articles = (data.articles || []).slice(0, 5);
    if (!articles.length) return ctx.reply("No news right now.");
    const text = articles.map((a, i) => `${i + 1}. *${a.title}*${a.description ? `\n${a.description}` : ""}`).join("\n\n");
    return ctx.reply(`📰 *Latest news*\n\n${text}`);
  },
};
