"use strict";

const { groupData } = require("../services/settings");
const { enforce } = require("../services/moderation");

/**
 * Group protection rules (antibadword, antilink, antitag). Admins, sudo users, owners
 * and the bot itself are never affected. Nothing happens unless the bot is a group admin.
 */

// Word list kept from the original bot; matching is on whole words / exact phrases.
const BAD_WORDS = new Set(
  [
    "gandu", "madarchod", "bhosdike", "bsdk", "fucker", "bhosda", "lauda", "laude", "betichod", "chutiya", "behenchod",
    "randi", "chuchi", "boobs", "boobies", "tits", "idiot", "nigga", "fuck", "dick", "bitch", "bastard", "asshole",
    "lund", "mc", "lodu", "benchod", "shit", "damn", "hell", "piss", "crap", "slut", "whore", "prick", "motherfucker",
    "cock", "cunt", "pussy", "twat", "wanker", "douchebag", "jackass", "moron", "retard", "scumbag", "skank", "slutty",
    "arse", "bugger", "chut", "madar", "chodne", "harami", "chodu", "kameena", "haramzada", "chamiya", "chudai", "fck",
    "fckr", "fcker", "fuk", "fukk", "fcuk", "btch", "bch", "assclown", "l0du", "lund69", "spic", "chink", "cracker",
    "towelhead", "gook", "kike", "paki", "honky", "wetback", "raghead", "beaner", "blowjob", "handjob", "cum", "cumshot",
    "jizz", "deepthroat", "fap", "hentai", "milf", "anal", "orgasm", "dildo", "vibrator", "gangbang", "threesome", "porn",
    "sex", "xxx", "fag", "faggot", "dyke", "tranny", "homo", "sissy", "lesbo", "weed", "coke", "heroin", "meth", "crack",
    "dope", "bong", "kush",
  ],
);
const BAD_PHRASES = [
  "maa ki chut", "behen ki chut", "teri ma ki chut", "teri maa ki", "lund ke baal", "sod off", "laude ka baal",
  "behen ke lode", "sala kutta", "randi ki aulad", "gaand mara", "lund le", "gandu saala", "chodne wala",
  "chutiye ke baap", "jungle bunny", "sand nigger", "tatto ke saudagar", "machar ki jhant", "jhant ka baal",
];

function containsBadWord(text) {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (clean.split(" ").some((w) => BAD_WORDS.has(w))) return true;
  return BAD_PHRASES.some((p) => ` ${clean} `.includes(` ${p} `));
}

const LINK_RE = /(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?/i;

async function isExempt(ctx) {
  if (ctx.fromMe || ctx.level === "owner" || ctx.level === "sudo") return true;
  return ctx.isSenderAdmin();
}

function rule(ctx, key) {
  const r = groupData(ctx.state).data[key]?.[ctx.chatId];
  return r?.enabled ? r : null;
}

module.exports = [
  {
    name: "antibadword",
    event: "message",
    phase: "pre",
    priority: 40,
    groupOnly: true,
    async run(ctx) {
      const r = rule(ctx, "antibadword");
      if (!r || !ctx.body || !containsBadWord(ctx.body)) return undefined;
      if ((await isExempt(ctx)) || !(await ctx.isBotAdmin())) return undefined;
      await enforce(ctx, r.action, "bad language");
      return "stop";
    },
  },
  {
    name: "antilink",
    event: "message",
    phase: "pre",
    priority: 41,
    groupOnly: true,
    async run(ctx) {
      const r = rule(ctx, "antilink");
      if (!r || !ctx.body || !LINK_RE.test(ctx.body)) return undefined;
      if ((await isExempt(ctx)) || !(await ctx.isBotAdmin())) return undefined;
      await enforce(ctx, r.action, "posting links");
      return "stop";
    },
  },
  {
    name: "antitag",
    event: "message",
    phase: "post",
    priority: 20,
    groupOnly: true,
    async run(ctx) {
      const r = rule(ctx, "antitag");
      if (!r) return undefined;
      const numeric = new Set((ctx.body.match(/@\d{10,}/g) || []).map((m) => m.slice(1)));
      const total = Math.max(ctx.mentions.length, numeric.size);
      if (total < 3) return undefined;
      const meta = await ctx.groupMetadata();
      const threshold = Math.ceil((meta?.participants.length || 0) * 0.5);
      if (total < threshold && numeric.size < 10) return undefined;
      if ((await isExempt(ctx)) || !(await ctx.isBotAdmin())) return undefined;
      await enforce(ctx, r.action === "kick" ? "kick" : "delete", "mass tagging");
      return "stop";
    },
  },
];

module.exports.containsBadWord = containsBadWord;
module.exports.LINK_RE = LINK_RE;
