"use strict";

const net = require("../../services/nettools");

const usageOf = (ctx, name, example) => `Usage: ${ctx.prefix}${name} ${example}`;

module.exports = [
  {
    name: "dns",
    aliases: ["nslookup", "dig"],
    category: "info",
    description: "Looks up a domain's DNS records: A/AAAA (addresses), CNAME, MX (mail), NS (name servers) and TXT (SPF, verification …).",
    usage: "<domain or link>",
    examples: [".dns example.com", ".dns https://www.wikipedia.org"],
    cooldown: 5,
    externalService: "the server's DNS resolver",
    async run(ctx) {
      const host = net.domainOf(ctx.text);
      if (!host) return ctx.reply(usageOf(ctx, "dns", "example.com"));
      const rec = await net.lookup(host);
      const types = Object.keys(rec);
      if (!types.length) return ctx.reply(`No DNS records found for ${host} (the name may not exist).`);
      const clip = (s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
      const lines = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"]
        .filter((t) => rec[t])
        .map((t) => `*${t}*\n${rec[t].slice(0, 8).map((v) => `  ${clip(String(v))}`).join("\n")}${rec[t].length > 8 ? `\n  … ${rec[t].length - 8} more` : ""}`);
      return ctx.reply(`🖧 *DNS — ${host}*\n\n${lines.join("\n\n")}`);
    },
  },
  {
    name: "ssl",
    aliases: ["cert", "tls"],
    category: "info",
    description: "Checks a website's HTTPS certificate: who issued it, whether it is trusted, and when it expires.",
    usage: "<domain or link>",
    examples: [".ssl example.com"],
    cooldown: 5,
    externalService: "the website itself (port 443)",
    async run(ctx) {
      const host = net.domainOf(ctx.text);
      if (!host) return ctx.reply(usageOf(ctx, "ssl", "example.com"));
      const c = await net.certificate(host);
      const state = !c.trusted ? `❌ Not trusted: ${c.problem}` : c.daysLeft < 0 ? "❌ Expired" : c.daysLeft <= 14 ? `⚠️ Expires soon (in ${c.daysLeft} days)` : `✅ Valid (${c.daysLeft} days left)`;
      const names = c.names.length ? `\n🌐 Covers: ${c.names.slice(0, 6).join(", ")}${c.names.length > 6 ? ` +${c.names.length - 6} more` : ""}` : "";
      return ctx.reply(`🔐 *HTTPS certificate — ${host}*\n\n${state}\n🏢 Issued by: ${c.issuer || "?"}\n📅 ${c.validFrom} → ${c.validTo}\n🔤 For: ${c.subject}${names}\n🔗 ${c.protocol}`);
    },
  },
  {
    name: "up",
    aliases: ["isup", "ping-site", "sitecheck"],
    category: "info",
    description: "Checks whether a website is answering, with the HTTP status and response time.",
    usage: "<domain or link>",
    examples: [".up example.com", ".up https://www.wikipedia.org/wiki/Main_Page"],
    cooldown: 5,
    externalService: "the website itself",
    async run(ctx) {
      const host = net.domainOf(ctx.text);
      if (!host) return ctx.reply(usageOf(ctx, "up", "example.com"));
      const link = /^https?:\/\//i.test(ctx.text.trim()) ? ctx.text.trim().split(/\s/)[0] : `https://${host}/`;
      const r = await net.check(link);
      if (!r.up) return ctx.reply(`🔴 *${host}* is not answering (${r.error}, after ${r.ms} ms).`);
      const moved = new URL(r.finalUrl).hostname !== host ? `\n↪️ Redirects to ${new URL(r.finalUrl).hostname}` : "";
      const icon = r.status >= 500 ? "🟠" : "🟢";
      return ctx.reply(`${icon} *${host}* is up — HTTP ${r.status ?? "?"} in ${r.ms} ms${moved}${r.status >= 500 ? "\n(The server answers but reports an error.)" : ""}`);
    },
  },
];
