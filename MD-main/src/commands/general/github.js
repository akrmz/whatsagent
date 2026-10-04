"use strict";

const { getJson } = require("../../core/http");

module.exports = {
  name: "github",
  aliases: ["git", "sc", "script", "repo"],
  category: "general",
  description: "Shows the bot's source repository (set GITHUB_REPO in .env).",
  cooldown: 30,
  requires: ["githubRepo"],
  externalService: "api.github.com",

  async run(ctx) {
    const repo = await getJson(`https://api.github.com/repos/${ctx.config.githubRepo}`, {
      headers: { "user-agent": "whatsapp-bot", accept: "application/vnd.github+json" },
    });
    const text = [
      `*${repo.full_name}*`,
      repo.description || "",
      "",
      `⭐ Stars: ${repo.stargazers_count}   🍴 Forks: ${repo.forks_count}`,
      `🕒 Updated: ${new Date(repo.pushed_at || repo.updated_at).toISOString().slice(0, 10)}`,
      `🔗 ${repo.html_url}`,
    ].join("\n");
    return ctx.reply(text);
  },
};
