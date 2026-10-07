"use strict";

const memes = require("../../services/memes");

module.exports = {
  name: "smeme",
  aliases: ["memegen", "mememaker", "captionimg"],
  category: "image",
  description: 'Makes a meme: big white text with a black outline on a picture. "top | bottom" for both, "| bottom" for the bottom only. Arabic works. Made on the server.',
  usage: "<top text> | <bottom text> (send or reply to a picture)",
  examples: ["(reply to a picture) .smeme when the code works | on the first try", "(reply to a picture) .smeme | لما الكود يشتغل من أول مرة"],
  cooldown: 5,
  async run(ctx) {
    const media = ctx.findMedia({ types: ["image", "sticker"] });
    const text = memes.parseCaption(ctx.text);
    if (!media || !text) return ctx.reply(`Reply to a picture with ${ctx.prefix}smeme top text | bottom text`);
    const out = await memes.caption(await ctx.download(media, 15 * 1024 * 1024), text);
    return ctx.reply({ image: out });
  },
};
