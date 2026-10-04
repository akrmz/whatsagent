"use strict";

const { getJson } = require("../../core/http");
const { getImage } = require("../../services/external");
const { toSticker } = require("../../core/media");
const { stickerOptions } = require("../../services/stickers");

module.exports = {
  name: "emojimix",
  aliases: ["emix"],
  category: "sticker",
  description: "Mixes two emojis into one sticker (Google Emoji Kitchen).",
  usage: "<emoji1>+<emoji2>",
  examples: [".emojimix 😎+🥰"],
  cooldown: 5,
  requires: ["tenor", "ffmpeg"],
  externalService: "tenor.googleapis.com",

  async run(ctx) {
    const [a, b] = ctx.text.split("+").map((s) => s.trim());
    if (!a || !b) return ctx.reply(`🎴 Example: ${ctx.prefix}emojimix 😎+🥰`);
    const qs = new URLSearchParams({
      key: ctx.config.keys.tenor,
      contentfilter: "high",
      media_filter: "png_transparent",
      component: "proactive",
      collection: "emoji_kitchen_v5",
      q: `${a}_${b}`,
    });
    const data = await getJson(`https://tenor.googleapis.com/v2/featured?${qs}`);
    const url = data.results?.[0]?.url;
    if (!url) return ctx.reply("❌ These emojis cannot be mixed. Try different ones.");
    const sticker = await toSticker(await getImage(url), stickerOptions(ctx));
    return ctx.reply({ sticker });
  },
};
