"use strict";

/** Builds the .help menu from command metadata, so it can never drift from the real commands. */

const CATEGORY_ORDER = ["general", "tools", "realestate", "info", "islamic", "admin", "owner", "sticker", "image", "audio", "textmaker", "download", "ai", "fun", "misc", "anime", "games"];
const CATEGORY_TITLES = {
  general: "🌐 General",
  tools: "🛠️ Tools",
  realestate: "🏠 Real estate · عقارات",
  info: "📚 Info & search",
  islamic: "🕌 Islamic · إسلاميات",
  admin: "👮 Group admin",
  owner: "🔒 Owner",
  sticker: "🎨 Stickers",
  image: "🖼️ Images",
  audio: "🎵 Audio effects",
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

// Who can see which commands in the menus (they can still ask .help <command> for any).
const VISIBLE_TO = { owner: ["owner"], sudo: ["owner", "sudo"] };
/** Commands this user may run (owner-only ones hidden from others; sudo ones from users). */
const visibleFor = (commands, level) => commands.filter((c) => !VISIBLE_TO[c.permission] || VISIBLE_TO[c.permission].includes(level));

// The most useful commands of each section, shown first in the short overview.
const FEATURED = {
  general: ["help", "ping", "translate", "tts", "owner"],
  tools: ["calc", "remind", "poll", "qr", "currency", "save", "autos"],
  realestate: ["listing", "listings", "flyer", "installments", "adcopy", "agent"],
  info: ["weather", "wiki", "news", "time", "define", "crypto"],
  islamic: ["azkar", "dua", "quran", "tafsir", "prayer", "autoazkar", "autowird", "hadith"],
  admin: ["kick", "promote", "antilink", "welcome", "captcha", "tagall", "mute"],
  owner: ["doctor", "setvar", "setai", "update", "backup", "vars"],
  sticker: ["sticker", "take", "simage", "tovideo"],
  image: ["removebg", "grayscale", "resize", "compress", "circlecrop"],
  audio: ["bass", "nightcore", "slow", "deep", "reverse"],
  download: ["song", "video", "yts", "tiktok", "instagram", "dl"],
  ai: ["ai", "imagine", "transcribe", "summarize"],
  games: ["tictactoe", "mathquiz", "rank", "rps", "trivia"],
};

/** A short overview: each section with its size and a few key commands. */
function renderOverview({ commands, prefix, botName, version, level = "user" }) {
  const lines = [`*${botName}*${version ? ` v${version}` : ""}`, ""];
  for (const [category, list] of byCategory(visibleFor(commands, level))) {
    const names = new Set(list.map((c) => c.name));
    const featured = (FEATURED[category] || []).filter((n) => names.has(n));
    const shown = [...featured, ...list.map((c) => c.name).filter((n) => !featured.includes(n))].slice(0, 6);
    lines.push(`*${CATEGORY_TITLES[category] || category}* (${list.length})`, `   ${shown.map((n) => prefix + n).join("  ")}`);
  }
  lines.push("", `📋 ${prefix}help <section> — e.g. ${prefix}help islamic`, `🔎 ${prefix}help <command> — details`, `📚 ${prefix}menu — every command`);
  return lines.join("\n");
}

function renderMenu({ commands, prefix, botName, version, level = "owner" }) {
  const lines = [`*${botName}*${version ? ` v${version}` : ""}`, `Prefix: ${prefix}   ·   ${prefix}help <command> or ${prefix}help <section> for details`, ""];
  for (const [category, list] of byCategory(visibleFor(commands, level))) {
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

/** Matches "download", "downloads", "Stickers", "info" … to a category key. */
function findCategory(input, commands) {
  const q = String(input || "").toLowerCase().replace(/s$/, "");
  if (!q) return null;
  const keys = byCategory(commands).map(([k]) => k);
  return (
    keys.find((k) => k === q || k.replace(/s$/, "") === q) ||
    keys.find((k) => (CATEGORY_TITLES[k] || "").toLowerCase().replace(/[^a-z& ]/g, "").trim().split(/\s+/).some((w) => w.replace(/s$/, "") === q)) ||
    null
  );
}

function renderCategory(category, commands, prefix) {
  const list = byCategory(commands).find(([k]) => k === category)?.[1] || [];
  const lines = [`*${CATEGORY_TITLES[category] || category}* (${list.length})`, ""];
  for (const c of list) lines.push(`• ${prefix}${c.name}${c.usage ? ` ${c.usage}` : ""}${PERMISSION_BADGE[c.permission] || ""}\n   _${c.description}_`);
  lines.push("", `${prefix}help <command> for details`);
  return lines.join("\n");
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Up to 3 visible command names close to a mistyped one ("stiker" → sticker). */
function suggest(name, byName) {
  const scored = [];
  for (const [alias, c] of byName) {
    if (c.hidden) continue;
    const d = distance(name, alias);
    if (d <= (name.length > 4 ? 2 : 1)) scored.push([d, c.name]);
  }
  return [...new Set(scored.sort((x, y) => x[0] - y[0]).map(([, n]) => n))].slice(0, 3);
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

module.exports = { renderMenu, renderOverview, visibleFor, renderCommand, renderCategory, findCategory, suggest, byCategory, CATEGORY_ORDER, CATEGORY_TITLES };
