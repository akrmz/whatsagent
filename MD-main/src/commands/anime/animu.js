"use strict";

const { getJson } = require("../../core/http");
const { getImage } = require("../../services/external");
const { toSticker } = require("../../core/media");
const { stickerOptions } = require("../../services/stickers");

const TYPES = ["nom", "poke", "cry", "kiss", "pat", "hug", "wink", "face-palm", "quote"];

async function sendAnimu(ctx, type) {
  const data = await getJson(`https://api.some-random-api.com/animu/${type}`);
  if (data.quote) return ctx.reply(data.quote);
  if (!data.link) return ctx.reply("❌ Failed to fetch anime media.");
  const media = await getImage(data.link, { maxBytes: 10 * 1024 * 1024 });
  if (ctx.app.capabilities.ffmpeg) {
    const animated = data.link.toLowerCase().endsWith(".gif");
    const sticker = await toSticker(media, { ...stickerOptions(ctx), animated, emojis: ["🎌"] });
    return ctx.reply({ sticker });
  }
  return ctx.reply({ image: media, caption: `anime: ${type}` });
}

const base = { category: "anime", cooldown: 5, externalService: "api.some-random-api.com" };

module.exports = [
  {
    ...base,
    name: "animu",
    description: `Sends an anime reaction sticker. Types: ${TYPES.join(", ")}.`,
    usage: "<type>",
    examples: [".animu hug"],
    async run(ctx) {
      const type = (ctx.args[0] || "").toLowerCase().replace(/^facepalm$/, "face-palm").replace(/^animuquote$/, "quote");
      if (!TYPES.includes(type)) return ctx.reply(`Usage: ${ctx.prefix}animu <type>\nTypes: ${TYPES.join(", ")}`);
      return sendAnimu(ctx, type);
    },
  },
  ...["nom", "poke", "cry", "kiss", "pat", "hug", "wink"].map((type) => ({
    ...base,
    name: type,
    description: `Sends a "${type}" anime reaction sticker.`,
    run: (ctx) => sendAnimu(ctx, type),
  })),
  { ...base, name: "facepalm", aliases: ["face-palm"], description: "Sends a facepalm anime sticker.", run: (ctx) => sendAnimu(ctx, "face-palm") },
  { ...base, name: "animuquote", description: "Sends a random anime quote.", run: (ctx) => sendAnimu(ctx, "quote") },
];
