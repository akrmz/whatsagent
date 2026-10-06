"use strict";

const news = require("../../services/news");

const REGION_RE = /^([a-z]{2}):([a-z]{2})$/i;

module.exports = {
  name: "news",
  aliases: ["headlines"],
  category: "info",
  description: "Latest headlines (Google News, no key needed), or news about a topic. Start with a country:language code for another region.",
  usage: "[CC:lang] [topic]",
  examples: [".news", ".news football", ".news eg:ar", ".news us:en elections"],
  cooldown: 15,
  externalService: "news.google.com (the topic is sent)",

  async run(ctx) {
    let region = ctx.config.news.region;
    let topic = ctx.text.trim();
    const first = ctx.args[0] || "";
    const m = first.match(REGION_RE);
    if (m) {
      region = `${m[1].toUpperCase()}:${m[2].toLowerCase()}`;
      topic = topic.slice(first.length).trim();
    }
    await ctx.react("📰");
    const items = (await news.headlines(region, topic.slice(0, 100))).slice(0, 10);
    if (!items.length) return ctx.reply(`No news found${topic ? ` for "${topic}"` : ""} (${region}).`);
    const lines = items.map((n, i) => `*${i + 1}.* ${n.title}\n    _${[n.source, news.ago(n.date)].filter(Boolean).join(" · ")}_`);
    return ctx.reply(`📰 *${topic ? `News: ${topic.slice(0, 50)}` : "Top stories"}* (${region})\n\n${lines.join("\n\n")}`);
  },
};
