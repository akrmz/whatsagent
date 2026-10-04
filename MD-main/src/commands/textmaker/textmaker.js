"use strict";

const { getImage } = require("../../services/external");
const { UserError } = require("../../core/errors");

/** One command per ephoto360 effect. To add an effect, add a line here. */
const EFFECTS = {
  metallic: "https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html",
  ice: "https://en.ephoto360.com/ice-text-effect-online-101.html",
  snow: "https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html",
  impressive: "https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html",
  matrix: "https://en.ephoto360.com/matrix-text-effect-154.html",
  light: "https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html",
  neon: "https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html",
  devil: "https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html",
  purple: "https://en.ephoto360.com/purple-text-effect-online-100.html",
  thunder: "https://en.ephoto360.com/thunder-text-effect-online-97.html",
  leaves: "https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html",
  1917: "https://en.ephoto360.com/1917-style-text-effect-523.html",
  arena: "https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html",
  hacker: "https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html",
  sand: "https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html",
  blackpink: "https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html",
  glitch: "https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html",
  fire: "https://en.ephoto360.com/flame-lettering-effect-372.html",
};

module.exports = Object.entries(EFFECTS).map(([name, url]) => ({
  name,
  category: "textmaker",
  description: `Writes your text with the "${name}" effect.`,
  usage: "<text>",
  examples: [`.${name} Hello`],
  cooldown: 10,
  externalService: "ephoto360.com",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Please provide text, e.g. ${ctx.prefix}${name} Nick`);
    if (ctx.text.length > 40) throw new UserError("Text is too long (max 40 characters).");
    const mumaker = require("mumaker");
    let result;
    try {
      result = await mumaker.ephoto(url, ctx.text);
    } catch (err) {
      ctx.log.warn({ err: err.message, effect: name }, "ephoto360 failed");
      throw new UserError("The text-effect website is not responding. Try again later.");
    }
    if (!result?.image) throw new UserError("The text-effect website returned no image.");
    const image = await getImage(result.image);
    return ctx.reply({ image });
  },
}));
