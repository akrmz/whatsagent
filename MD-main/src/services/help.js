"use strict";

/** Builds the .help menu from command metadata, so it can never drift from the real commands. */

const CATEGORY_ORDER = ["general", "admin", "owner", "sticker", "image", "textmaker", "download", "ai", "fun", "misc", "anime", "games"];
const CATEGORY_TITLES = {
  general: "🌐 General",
  admin: "👮 Group admin",
  owner: "🔒 Owner",
  sticker: "🎨 Stickers",
  image: "🖼️ Images",
  textmaker: "🔤 Text effects",
  download: "📥 Downloads",
  ai: "🤖 AI",
  fun: "🎯 Fun",
  misc: "🧩 Image effects",
  anime: "🎌 Anime",
  games: "🎮 Games",
};
const PERMISSION_BADGE = { owner: " 👑", sudo: " 🛡️", groupAdmin: " 👮", user: "" };

function byCategory(commands) {
  const groups = new Map();
  for (const c of commands) {
    if (c.hidden) continue;
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const order = [...CATEGORY_ORDER, ...[...groups.keys()].filter((k) => !CATEGORY_ORDER.includes(k)).sort()];
  return order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k).sort((a, b) => a.name.localeCompare(b.name))]);
}

function renderMenu({ commands, prefix, botName, version }) {
  const lines = [`*${botName}*${version ? ` v${version}` : ""}`, `Prefix: ${prefix}   ·   ${prefix}help <command> for details`, ""];
  for (const [category, list] of byCategory(commands)) {
    lines.push(`*${CATEGORY_TITLES[category] || category}*`);
    for (const c of list) {
      const usage = c.usage ? ` ${c.usage}` : "";
      lines.push(`• ${prefix}${c.name}${usage}${PERMISSION_BADGE[c.permission] || ""}`);
    }
    lines.push("");
  }
  lines.push("👑 owner only · 🛡️ owner or sudo · 👮 group admins");
  return lines.join("\n").trim();
}

function renderCommand(c, prefix) {
  const who = {
    owner: "bot owner",
    sudo: "bot owner and sudo users",
    groupAdmin: "group admins (and the owner)",
    user: "everyone",
  }[c.permission];
  const where = c.groupOnly || c.permission === "groupAdmin" ? "groups only" : c.privateOnly ? "private chat only" : "anywhere";
  const lines = [
    `*${prefix}${c.name}*${c.usage ? ` ${c.usage}` : ""}`,
    c.description,
    "",
    `Who: ${who}`,
    `Where: ${where}`,
  ];
  if (c.aliases.length) lines.push(`Aliases: ${c.aliases.map((a) => prefix + a).join(", ")}`);
  if (c.cooldown) lines.push(`Cooldown: ${c.cooldown}s`);
  if (c.botAdmin) lines.push("The bot must be a group admin.");
  if (c.externalService) lines.push(`Uses external service: ${c.externalService}`);
  if (c.examples?.length) lines.push("", "Examples:", ...c.examples.map((e) => `  ${e.replace(/^\./, prefix)}`));
  return lines.join("\n");
}

module.exports = { renderMenu, renderCommand, byCategory, CATEGORY_ORDER };
