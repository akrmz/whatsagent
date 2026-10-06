"use strict";

const cookies = require("../../services/cookies");
const { HOSTS, siteKey } = require("../../services/sites");
const { getText } = require("../../core/context");
const { tryDeleteSecretMessage } = require("../../services/secrets");

const SITES = Object.keys(HOSTS).join(", ");
const date = (d) => d.toISOString().slice(0, 10);

const HOW_TO = [
  "*How to get cookies* (use a spare account if you can — sites may block accounts used by bots):",
  "1. On a computer, install the browser extension *Get cookies.txt LOCALLY* (or *Cookie-Editor*).",
  "2. Log in to the site, e.g. youtube.com. For YouTube, use a private/incognito window and close it right after exporting, so the cookies stay valid.",
  "3. Export the cookies (cookies.txt, or JSON in Cookie-Editor).",
  "4. Send the file to the bot *in a private chat* with the caption .setcookie youtube (or reply to the file with it).",
].join("\n");

async function readInput(ctx, rest) {
  const doc = ctx.findMedia({ types: ["document"] });
  if (doc) return (await ctx.download(doc, 1024 * 1024)).toString("utf8");
  if (rest) return rest;
  return ctx.quoted ? getText(ctx.quoted.message) : "";
}

module.exports = [
  {
    name: "setcookie",
    aliases: ["setcookies", "addcookie"],
    category: "owner",
    description: `Saves login cookies for one site so downloads that need a login work (age-restricted/members YouTube, private Instagram …). Sites: ${SITES}.`,
    usage: "<site> (attach or reply to cookies.txt / JSON, or paste)",
    examples: [".setcookie youtube (caption of a cookies.txt file)", ".setcookie instagram sessionid=…; csrftoken=…"],
    permission: "owner",
    privateOnly: true, // cookies are passwords: never in a group
    cooldown: 5,
    async run(ctx) {
      const [name] = ctx.args;
      const site = siteKey(name);
      if (!site) return ctx.reply(`Usage: ${ctx.prefix}setcookie <site>\nSites: ${SITES}\n\n${HOW_TO}`);
      const rest = ctx.text.slice(name.length).trim();
      const input = await readInput(ctx, rest);
      if (!input) return ctx.reply(`Attach the cookies file with the caption ${ctx.prefix}setcookie ${site}, or reply to it.\n\n${HOW_TO}`);
      const { cookies: list, dropped, format } = cookies.parse(input, site);
      cookies.save(ctx.config, site, list);
      const deleted = await tryDeleteSecretMessage(ctx);
      const s = cookies.summarize(list, site);
      const lines = [
        `🍪 Saved ${s.count} ${site} cookie(s) from ${format}.`,
        dropped ? `Ignored ${dropped} cookie(s) for other sites.` : null,
        s.expired ? `⚠️ ${s.expired} of them are already expired.` : null,
        s.knowsLogin ? (s.loggedIn ? `✅ Logged-in session found${s.loginExpires ? ` (valid until ${date(s.loginExpires)})` : ""}.` : "⚠️ No login cookie found — were you logged in when exporting?") : null,
        `Downloads from ${site} now use them.`,
        deleted ? "🧹 I deleted your message with the cookies." : "🧹 Delete your message with the cookies from this chat now (they are a password).",
      ];
      return ctx.reply(lines.filter(Boolean).join("\n"));
    },
  },
  {
    name: "cookies",
    aliases: ["listcookies", "cookie"],
    category: "owner",
    description: "Shows which sites have saved cookies, whether they contain a login, and when it expires (values are never shown).",
    permission: "owner",
    async run(ctx) {
      const sites = cookies.savedSites(ctx.config);
      const lines = ["🍪 *Saved cookies*", ""];
      if (!sites.length) lines.push("None yet.");
      for (const site of sites) {
        const { cookies: list, updated } = cookies.read(ctx.config, site);
        const s = cookies.summarize(list, site);
        const login = !s.knowsLogin ? "" : s.loggedIn ? ` · ✅ login${s.loginExpires ? ` until ${date(s.loginExpires)}` : ""}` : " · ⚠️ no login";
        lines.push(`• *${site}*: ${s.count} cookies${login} · saved ${date(updated)}`);
      }
      if (ctx.config.tools.ytdlpCookies) lines.push("", "Other sites use the YTDLP_COOKIES file from .env.");
      lines.push("", `Add: ${ctx.prefix}setcookie <site> (in private chat) · Remove: ${ctx.prefix}delcookie <site>`);
      return ctx.reply(lines.join("\n"));
    },
  },
  {
    name: "delcookie",
    aliases: ["delcookies", "rmcookie"],
    category: "owner",
    description: "Deletes the saved cookies of a site (or all).",
    usage: "<site | all>",
    examples: [".delcookie youtube", ".delcookie all"],
    permission: "owner",
    async run(ctx) {
      const arg = (ctx.args[0] || "").toLowerCase();
      if (arg === "all") {
        const sites = cookies.savedSites(ctx.config);
        sites.forEach((s) => cookies.remove(ctx.config, s));
        return ctx.reply(sites.length ? `🗑️ Deleted cookies for ${sites.join(", ")}.` : "There are no saved cookies.");
      }
      const site = siteKey(arg);
      if (!site) return ctx.reply(`Usage: ${ctx.prefix}delcookie <site | all>`);
      return ctx.reply(cookies.remove(ctx.config, site) ? `🗑️ Deleted the ${site} cookies.` : `There are no saved ${site} cookies.`);
    },
  },
];
