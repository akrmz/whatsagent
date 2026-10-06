"use strict";

const { toPng } = require("../../core/media");
const { UserError } = require("../../core/errors");

/**
 * Picture effects done on the server with sharp. Nothing is uploaded anywhere.
 * Each command works on the image or sticker you send or reply to.
 */

const MAX_SIDE = 4096;
const SEPIA = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];

async function input(ctx) {
  const media = ctx.findMedia({ types: ["image", "sticker", "document"] });
  if (!media || (media.type === "document" && !/^image\//.test(media.mimetype))) {
    throw new UserError(`Send or reply to a picture with ${ctx.prefix}${ctx.commandName}`);
  }
  const buffer = await ctx.download(media, 15 * 1024 * 1024);
  return media.type === "sticker" ? toPng(buffer) : buffer;
}

const sharpOf = (buffer) => require("sharp")(buffer, { animated: false, limitInputPixels: 64e6 }).rotate();

/** Builds a command that applies `transform(img, ctx)` and sends the result as JPEG (or PNG with transparency). */
function effect(name, { aliases = [], description, usage, examples, transform, png = false }) {
  return {
    name,
    aliases,
    category: "image",
    description: `${description} Works on the picture or sticker you send or reply to; done on the server, nothing is uploaded.`,
    usage: usage || "(send or reply to a picture)",
    examples,
    cooldown: 5,
    async run(ctx) {
      const img = await transform(sharpOf(await input(ctx)), ctx);
      const image = png ? await img.png().toBuffer() : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
      return ctx.reply({ image });
    },
  };
}

function number(ctx, def, min, max, label) {
  if (!ctx.args[0]) return def;
  const n = Number(String(ctx.args[0]).replace(/[%°x]$/i, ""));
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${label} must be between ${min} and ${max}.`);
  return n;
}

module.exports = [
  effect("grayscale", { aliases: ["gray", "grey", "bw"], description: "Black and white.", transform: (img) => img.grayscale() }),
  effect("invert", { aliases: ["negative"], description: "Inverts the colours.", transform: (img) => img.negate({ alpha: false }) }),
  effect("sepia", { description: "Old-photo sepia tone.", transform: (img) => img.recomb(SEPIA) }),
  effect("mirror", { aliases: ["flop"], description: "Mirrors left ↔ right.", transform: (img) => img.flop() }),
  effect("flipimg", { aliases: ["flipv"], description: "Flips upside down.", transform: (img) => img.flip() }),
  effect("rotate", {
    description: "Rotates by 90° (or the angle you give).",
    usage: "[degrees] (reply to a picture)",
    examples: [".rotate", ".rotate 180", ".rotate -45"],
    transform: (img, ctx) => img.rotate(number(ctx, 90, -360, 360, "The angle"), { background: "#ffffff" }),
  }),
  effect("sharpen", { description: "Makes a blurry picture sharper.", transform: (img) => img.sharpen({ sigma: 1.5 }) }),
  effect("brighten", {
    aliases: ["bright"],
    description: "Makes it brighter (or darker below 1).",
    usage: "[amount 0.3-3] (reply to a picture)",
    examples: [".brighten", ".brighten 0.7"],
    transform: (img, ctx) => img.modulate({ brightness: number(ctx, 1.3, 0.3, 3, "The amount") }),
  }),
  effect("saturate", {
    aliases: ["vivid"],
    description: "Makes colours stronger (or weaker below 1).",
    usage: "[amount 0-4] (reply to a picture)",
    transform: (img, ctx) => img.modulate({ saturation: number(ctx, 1.6, 0, 4, "The amount") }),
  }),
  effect("pixelate", {
    aliases: ["pixel", "censor"],
    description: "Pixelates the picture.",
    usage: "[block size 4-64] (reply to a picture)",
    async transform(img, ctx) {
      const block = number(ctx, 16, 4, 64, "The block size");
      const { width, height } = await img.metadata();
      const small = await img
        .resize(Math.max(1, Math.round(width / block)), Math.max(1, Math.round(height / block)), { kernel: "nearest" })
        .png()
        .toBuffer();
      return require("sharp")(small).resize(width, height, { kernel: "nearest" });
    },
  }),
  effect("resize", {
    aliases: ["scale"],
    description: "Resizes to a width×height (keeps proportions when one side is 0), or by a percentage.",
    usage: "<WxH | N%> (reply to a picture)",
    examples: [".resize 512x512", ".resize 1080x0", ".resize 50%"],
    async transform(img, ctx) {
      const arg = String(ctx.args[0] || "");
      const { width, height } = await img.metadata();
      let w;
      let h;
      const pct = arg.match(/^(\d{1,3})%$/);
      const box = arg.match(/^(\d{1,4})[x×*](\d{1,4})$/i);
      if (pct && Number(pct[1]) >= 1 && Number(pct[1]) <= 400) {
        w = Math.round((width * Number(pct[1])) / 100);
        h = Math.round((height * Number(pct[1])) / 100);
      } else if (box) {
        w = Number(box[1]) || null;
        h = Number(box[2]) || null;
        if (!w && !h) throw new UserError("Give at least one side, e.g. 1080x0.");
      } else {
        throw new UserError(`Usage: ${ctx.prefix}resize 512x512  or  ${ctx.prefix}resize 50%`);
      }
      if ((w || 0) > MAX_SIDE || (h || 0) > MAX_SIDE || (w && w < 1) || (h && h < 1)) throw new UserError(`Each side must be 1 to ${MAX_SIDE} pixels.`);
      return img.resize(w || null, h || null, { fit: w && h ? "fill" : "inside" });
    },
  }),
  effect("circlecrop", {
    aliases: ["round"],
    description: "Crops to a circle with a transparent background (PNG).",
    png: true,
    async transform(img) {
      const square = await img.resize(1024, 1024, { fit: "cover" }).png().toBuffer();
      const mask = Buffer.from('<svg width="1024" height="1024"><circle cx="512" cy="512" r="512" fill="#fff"/></svg>');
      return require("sharp")(square).composite([{ input: mask, blend: "dest-in" }]);
    },
  }),
  {
    name: "compress",
    aliases: ["shrink"],
    category: "image",
    description: "Makes a picture smaller in bytes (JPEG at the quality you choose) and shows the size before and after.",
    usage: "[quality 10-90] (reply to a picture)",
    examples: [".compress", ".compress 30"],
    cooldown: 5,
    async run(ctx) {
      const quality = number(ctx, 50, 10, 90, "Quality");
      const original = await input(ctx);
      const out = await sharpOf(original).flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
      const kb = (b) => `${Math.round(b.length / 1024)} KB`;
      return ctx.reply({ document: out, mimetype: "image/jpeg", fileName: `compressed-q${quality}.jpg`, caption: `🗜️ ${kb(original)} → ${kb(out)}` });
    },
  },
  {
    name: "toformat",
    aliases: ["convertimg", "tojpg", "topng", "towebp"],
    category: "image",
    description: "Converts a picture or sticker to JPG, PNG or WebP and sends it as a file (so WhatsApp doesn't recompress it).",
    usage: "<jpg|png|webp> (reply to a picture)",
    examples: [".toformat png", ".topng", ".tojpg"],
    cooldown: 5,
    async run(ctx) {
      const fromAlias = { tojpg: "jpg", topng: "png", towebp: "webp" }[ctx.commandName];
      const format = (fromAlias || ctx.args[0] || "").toLowerCase().replace("jpeg", "jpg");
      if (!["jpg", "png", "webp"].includes(format)) return ctx.reply(`Usage: ${ctx.prefix}toformat jpg | png | webp`);
      let img = sharpOf(await input(ctx));
      img = format === "jpg" ? img.flatten({ background: "#ffffff" }).jpeg({ quality: 92 }) : format === "png" ? img.png() : img.webp({ quality: 90 });
      const mimetype = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[format];
      return ctx.reply({ document: await img.toBuffer(), mimetype, fileName: `image.${format}` });
    },
  },
  {
    name: "imginfo",
    aliases: ["exif"],
    category: "image",
    description: "Shows a picture's size, format and pixel dimensions.",
    usage: "(reply to a picture)",
    cooldown: 5,
    async run(ctx) {
      const buffer = await input(ctx);
      const m = await sharpOf(buffer).metadata();
      return ctx.reply(`🖼️ ${m.format?.toUpperCase()} · ${m.width}×${m.height} px · ${Math.round(buffer.length / 1024)} KB${m.hasAlpha ? " · transparency" : ""}${m.density ? ` · ${m.density} dpi` : ""}`);
    },
  },
];
