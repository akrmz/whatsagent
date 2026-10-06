"use strict";

const crypto = require("node:crypto");
const units = require("../../services/units");
const { formatNumber } = require("../../services/calc");
const { getText } = require("../../core/context");
const { request } = require("../../core/http");

const textOrQuoted = (ctx, text) => text || (ctx.quoted ? getText(ctx.quoted.message) : "");

/** "2000-05-14", "14/05/2000", "14-5-2000" → Date (UTC midnight) or null. */
function parseDate(s) {
  let m = String(s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y, mo, d;
  if (m) [, y, mo, d] = m.map(Number);
  else if ((m = String(s).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, mo, y] = m.map(Number);
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** Whole years, months and days between two dates. */
function diffYmd(from, to) {
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  let m = to.getUTCMonth() - from.getUTCMonth();
  let d = to.getUTCDate() - from.getUTCDate();
  if (d < 0) {
    m -= 1;
    d += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return { y, m, d };
}

const PASSWORD_SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_=+?"];

function password(length) {
  const all = PASSWORD_SETS.join("");
  // One from each set, the rest from all, then a cryptographic shuffle.
  const chars = PASSWORD_SETS.map((set) => set[crypto.randomInt(set.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

module.exports = [
  {
    name: "unit",
    aliases: ["units", "conv"],
    category: "tools",
    description: "Converts units: length, weight, volume, area (incl. feddan), speed, temperature, data, time, energy.",
    usage: "<value> <from> to <to>",
    examples: [".unit 10 km to mi", ".unit 100 f to c", ".unit 2 feddan to m2", ".unit 5 gb to mib", ".unit list"],
    cooldown: 3,
    async run(ctx) {
      if (/^list$/i.test(ctx.text)) return ctx.reply(`📏 *Units*\n\n${units.unitList()}`);
      const q = units.parse(ctx.text);
      if (!q) return ctx.reply(`Usage: ${ctx.prefix}unit 10 km to mi  ·  all units: ${ctx.prefix}unit list`);
      const r = units.convert(q.value, q.from, q.to);
      return ctx.reply(`📏 ${formatNumber(q.value)} ${r.from} = *${formatNumber(Number(r.value.toPrecision(10)))} ${r.to}*`);
    },
  },
  {
    name: "age",
    aliases: ["birthday", "datediff"],
    category: "tools",
    description: "Calculates an age (or time since a date) and the days to the next birthday.",
    usage: "<date> e.g. 2000-05-14 or 14/05/2000",
    examples: [".age 2000-05-14", ".age 14/05/2000"],
    cooldown: 3,
    async run(ctx) {
      const born = parseDate(ctx.text);
      if (!born) return ctx.reply(`Usage: ${ctx.prefix}age 2000-05-14  (or 14/05/2000)`);
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (born > today) {
        const days = Math.round((born - today) / 86400000);
        return ctx.reply(`📅 That date is in ${days} day(s).`);
      }
      const { y, m, d } = diffYmd(born, today);
      let next = new Date(Date.UTC(today.getUTCFullYear(), born.getUTCMonth(), born.getUTCDate()));
      if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, born.getUTCMonth(), born.getUTCDate()));
      const toNext = Math.round((next - today) / 86400000);
      const days = Math.round((today - born) / 86400000);
      const weekday = born.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      return ctx.reply(
        `🎂 *${y} years, ${m} months, ${d} days*\n= ${days.toLocaleString("en-US")} days\nBorn on a ${weekday}\n${toNext === 0 ? "🎉 Happy birthday!" : `Next birthday in ${toNext} day(s)`}`,
      );
    },
  },
  {
    name: "password",
    aliases: ["pass", "genpass"],
    category: "tools",
    description: "Generates a strong random password (cryptographically secure). Best used in a private chat.",
    usage: "[length 8-64]",
    examples: [".password", ".password 24"],
    cooldown: 3,
    async run(ctx) {
      const length = ctx.args[0] ? Number(ctx.args[0]) : 16;
      if (!Number.isInteger(length) || length < 8 || length > 64) return ctx.reply("Length must be 8 to 64.");
      const note = ctx.isGroup ? "\n\n⚠️ Everyone in this group can see it — generate passwords in a private chat." : "";
      return ctx.reply(`🔑 ${password(length)}${note}`);
    },
  },
  {
    name: "hash",
    category: "tools",
    description: "Shows the MD5, SHA-1, SHA-256 and SHA-512 hashes of a text (or the replied message).",
    usage: "<text>",
    examples: [".hash hello"],
    cooldown: 3,
    async run(ctx) {
      const text = textOrQuoted(ctx, ctx.text);
      if (!text) return ctx.reply(`Usage: ${ctx.prefix}hash <text>`);
      const lines = ["md5", "sha1", "sha256", "sha512"].map((a) => `*${a}*\n${crypto.createHash(a).update(text, "utf8").digest("hex")}`);
      return ctx.reply(lines.join("\n\n"));
    },
  },
  {
    name: "base64",
    aliases: ["b64"],
    category: "tools",
    description: "Encodes text to Base64 or decodes it back.",
    usage: "<encode|decode> <text>",
    examples: [".base64 encode hello", ".base64 decode aGVsbG8="],
    cooldown: 3,
    async run(ctx) {
      const [mode] = ctx.args;
      const text = textOrQuoted(ctx, ctx.text.slice((mode || "").length).trim());
      if (!/^(enc|encode|dec|decode)$/i.test(mode || "") || !text) return ctx.reply(`Usage: ${ctx.prefix}base64 encode <text>  or  ${ctx.prefix}base64 decode <text>`);
      if (/^enc/i.test(mode)) return ctx.reply(Buffer.from(text, "utf8").toString("base64"));
      const clean = text.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) return ctx.reply("That is not valid Base64.");
      const out = Buffer.from(clean, "base64").toString("utf8");
      return ctx.reply(out.includes("�") ? "That decodes to binary data, not text." : out);
    },
  },
  {
    name: "short",
    aliases: ["shorturl", "tinyurl", "shorten"],
    category: "tools",
    description: "Shortens a long link with TinyURL.",
    usage: "<link>",
    examples: [".short https://example.com/a/very/long/link"],
    cooldown: 10,
    externalService: "tinyurl.com (the link is sent)",
    async run(ctx) {
      const link = (textOrQuoted(ctx, ctx.text).match(/https?:\/\/[^\s<>"']+/i) || [])[0];
      if (!link) return ctx.reply(`Usage: ${ctx.prefix}short <link>`);
      const res = await request(`https://tinyurl.com/api-create.php?${new URLSearchParams({ url: link })}`, { timeoutMs: 15000, maxBytes: 4096 });
      const short = res.body.toString("utf8").trim();
      if (!/^https:\/\/tinyurl\.com\/\w+$/.test(short)) return ctx.reply("TinyURL could not shorten that link.");
      return ctx.reply(`🔗 ${short}`);
    },
  },
];

module.exports.parseDate = parseDate;
module.exports.diffYmd = diffYmd;
module.exports.password = password;
