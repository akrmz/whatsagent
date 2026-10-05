"use strict";

const QRCode = require("qrcode");
const jsQR = require("jsqr");
const sharp = require("sharp");
const { getText } = require("../../core/context");
const { toPng } = require("../../core/media");

// jsQR works on raw pixels; big photos are scaled down first (faster, same result).
const MAX_SIDE = 1200;

async function decode(buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: 40e6 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

module.exports = [
  {
    name: "qr",
    aliases: ["qrcode", "toqr"],
    category: "tools",
    description: "Makes a QR code image from text or a link. You can also reply to a message to encode it.",
    usage: "<text | link>",
    examples: [".qr https://example.com", ".qr WIFI:T:WPA;S:MyWifi;P:secret;;"],
    cooldown: 5,
    async run(ctx) {
      const text = ctx.text || (ctx.quoted ? getText(ctx.quoted.message) : "");
      if (!text) return ctx.reply(`Usage: ${ctx.prefix}qr <text or link>`);
      if (text.length > 1500) return ctx.reply("That is too long for a QR code (max 1500 characters).");
      const image = await QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 2, width: 512 });
      return ctx.reply({ image, caption: `🔳 ${text.length > 100 ? `${text.slice(0, 100)}…` : text}` });
    },
  },
  {
    name: "readqr",
    aliases: ["scanqr", "qrread"],
    category: "tools",
    description: "Reads the QR code in an image or sticker you send or reply to.",
    usage: "(reply to an image)",
    cooldown: 5,
    async run(ctx) {
      const media = ctx.findMedia({ types: ["image", "sticker"] });
      if (!media) return ctx.reply(`Send or reply to an image with ${ctx.prefix}readqr`);
      let buffer = await ctx.download(media, 10 * 1024 * 1024);
      if (media.type === "sticker") buffer = await toPng(buffer);
      const found = await decode(buffer);
      if (!found?.data) return ctx.reply("I couldn't find a readable QR code in that image.");
      return ctx.reply(`🔍 QR code content:\n\n${found.data.slice(0, 3000)}`);
    },
  },
];
