"use strict";

const { getImage } = require("../../services/external");

module.exports = {
  name: "meme",
  category: "fun",
  description: "Sends a random Cheems meme.",
  cooldown: 5,
  externalService: "shizoapi.onrender.com",

  async run(ctx) {
    const image = await getImage("https://shizoapi.onrender.com/api/memes/cheems?apikey=shizo");
    return ctx.reply({ image, caption: "Here's your Cheems meme! 🐕" });
  },
};
