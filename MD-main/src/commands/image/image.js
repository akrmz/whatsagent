"use strict";

const { request, getJson, multipart } = require("../../core/http");
const { getImage, uploadPublic } = require("../../services/external");
const { UserError } = require("../../core/errors");

async function imageFromMessage(ctx, maxBytes = 10 * 1024 * 1024) {
  const media = ctx.findMedia({ types: ["image"] });
  if (!media) throw new UserError(`Send or reply to an image with ${ctx.prefix}${ctx.commandName}.`);
  return { media, buffer: await ctx.download(media, maxBytes) };
}

module.exports = [
  {
    name: "blur",
    category: "image",
    description: "Blurs the image you send or reply to.",
    usage: "(send or reply to an image)",
    cooldown: 5,
    async run(ctx) {
      const sharp = require("sharp");
      const { buffer } = await imageFromMessage(ctx);
      const image = await sharp(buffer, { limitInputPixels: 64e6 })
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .blur(10)
        .jpeg({ quality: 80 })
        .toBuffer();
      return ctx.reply({ image, caption: "✅ Image blurred." });
    },
  },
  {
    name: "removebg",
    aliases: ["rmbg", "nobg"],
    category: "image",
    description: "Removes the background of the image you send or reply to.",
    usage: "(send or reply to an image)",
    cooldown: 20,
    requires: ["removeBg"],
    externalService: "remove.bg (the image is sent to this service)",
    async run(ctx) {
      const { buffer } = await imageFromMessage(ctx, 12 * 1024 * 1024);
      await ctx.react("⏳");
      const form = multipart([
        { name: "size", value: "auto" },
        { name: "image_file", value: buffer, filename: "image.jpg", contentType: "image/jpeg" },
      ]);
      const res = await request("https://api.remove.bg/v1.0/removebg", {
        method: "POST",
        headers: { "x-api-key": ctx.config.keys.removeBg, "content-type": form.contentType },
        body: form.body,
        timeoutMs: 60000,
        maxBytes: 20 * 1024 * 1024,
      });
      return ctx.reply({ document: res.body, mimetype: "image/png", fileName: "no-background.png", caption: "✨ Background removed." });
    },
  },
  {
    name: "remini",
    aliases: ["enhance", "upscale"],
    category: "image",
    description: "Enhances/upscales the image you send or reply to.",
    usage: "(send or reply to an image)",
    cooldown: 30,
    requires: ["remini"],
    externalService: "api.princetechn.com; the image is first uploaded to a PUBLIC file host",
    async run(ctx) {
      const { buffer, media } = await imageFromMessage(ctx);
      await ctx.react("⏳");
      const publicUrl = await uploadPublic(buffer, { filename: "image.jpg", contentType: media.mimetype || "image/jpeg" });
      const qs = new URLSearchParams({ apikey: ctx.config.keys.remini, url: publicUrl });
      const data = await getJson(`https://api.princetechn.com/api/tools/remini?${qs}`, { timeoutMs: 90000 });
      const resultUrl = data?.result?.image_url;
      if (!resultUrl) throw new UserError("The enhancement service could not process this image.");
      const image = await getImage(resultUrl, { maxBytes: 15 * 1024 * 1024 });
      return ctx.reply({ image, caption: "✨ Image enhanced." });
    },
  },
];
