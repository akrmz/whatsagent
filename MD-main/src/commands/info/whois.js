"use strict";

const { getJson, HttpError } = require("../../core/http");
const { UserError } = require("../../core/errors");
const { domainOf } = require("../../services/nettools");

const date = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");

function summary(j, asked) {
  const ev = Object.fromEntries((j.events || []).map((e) => [e.eventAction, e.eventDate]));
  const registrar = (j.entities || [])
    .filter((e) => (e.roles || []).includes("registrar"))
    .map((e) => e.vcardArray?.[1]?.find((x) => x[0] === "fn")?.[3])
    .find(Boolean);
  const ns = (j.nameservers || []).map((n) => String(n.ldhName || "").toLowerCase()).filter(Boolean);
  let left = "";
  if (ev.expiration) {
    const days = Math.floor((Date.parse(ev.expiration) - Date.now()) / 86400000);
    left = days >= 0 ? ` (in ${days.toLocaleString("en-US")} days)` : " (expired)";
  }
  return [
    `🌐 *${String(j.unicodeName || j.ldhName || asked).toLowerCase()}*`,
    "",
    `📝 Registered: ${date(ev.registration)}`,
    `⏳ Expires: ${date(ev.expiration)}${left}`,
    `✏️ Last changed: ${date(ev["last changed"])}`,
    registrar ? `🏢 Registrar: ${registrar}` : null,
    j.status?.length ? `🔒 Status: ${j.status.join(", ")}` : null,
    ns.length ? `🖧 Name servers: ${ns.slice(0, 6).join(", ")}` : null,
    "",
    "_Source: RDAP (the registries' official data). Owner details are usually hidden for privacy._",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

module.exports = {
  name: "whois",
  aliases: ["rdap", "domain"],
  category: "info",
  description: "Domain registration info: when it was registered and expires, the registrar, status and name servers (RDAP, the official registry data).",
  usage: "<domain or link>",
  examples: [".whois wikipedia.org", ".whois https://www.example.com/page"],
  cooldown: 5,
  externalService: "rdap.org and the domain's registry",
  async run(ctx) {
    const full = domainOf(ctx.text);
    if (!full) return ctx.reply(`Usage: ${ctx.prefix}whois example.com`);
    // Registries know the registered name, not subdomains: try "a.b.example.com", then "b.example.com", …
    const labels = full.split(".");
    let res;
    for (let i = 0; i <= labels.length - 2 && !res; i++) {
      const name = labels.slice(i).join(".");
      try {
        res = await getJson(`https://rdap.org/domain/${encodeURIComponent(name)}`, { timeoutMs: 20000, headers: { accept: "application/rdap+json, application/json" } });
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
      }
    }
    if (!res) throw new UserError(`No registration data for ${full}. Some country domains don't publish RDAP data.`);
    return ctx.reply(summary(res, full));
  },
  domainOf,
  summary,
};
