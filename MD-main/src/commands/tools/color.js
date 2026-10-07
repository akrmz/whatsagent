"use strict";

const colors = require("../../services/colors");

module.exports = {
  name: "color",
  aliases: ["colour", "hex", "rgb"],
  category: "tools",
  description: "Shows a colour as a picture with its HEX, RGB and HSL codes, and whether black or white text reads better on it (WCAG contrast). Drawn on the server.",
  usage: "<#hex | rgb(r,g,b) | name>",
  examples: [".color #1e90ff", ".color rgb(255, 99, 71)", ".color orange"],
  cooldown: 3,
  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}color #1e90ff · ${ctx.prefix}color rgb(255,99,71) · ${ctx.prefix}color orange`);
    const c = colors.parseColor(ctx.text);
    const d = colors.describe(c);
    const caption = `🎨 *${d.hex.toUpperCase()}*\n${d.rgb}\n${d.hsl}\n\nReadable text on it: *${d.text}* (contrast ${d.text === "black" ? d.onBlack : d.onWhite}:1; 4.5:1 or more is good)`;
    return ctx.reply({ image: await colors.swatch(c), caption });
  },
};
