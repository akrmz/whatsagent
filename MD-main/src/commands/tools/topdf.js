"use strict";

const pdf = require("../../services/pdf");
const { LRU } = require("../../core/lru");

const MAX_PAGES = 20;
// Pictures collected with ".topdf add", per person and chat, for 15 minutes (memory only).
const pending = new LRU({ max: 500, ttlMs: 15 * 60 * 1000 });

module.exports = {
  name: "topdf",
  aliases: ["pdf", "img2pdf"],
  category: "tools",
  description: `Turns pictures into a PDF document (A4, made on the server). One picture: send or reply to it with .topdf. Several pages: ".topdf add" on each picture, then ".topdf done" (up to ${MAX_PAGES} pages).`,
  usage: "[add | done | cancel] (send or reply to a picture)",
  examples: ["(reply to a picture) .topdf", "(reply to a picture) .topdf add", ".topdf done"],
  cooldown: 3,
  async run(ctx) {
    const key = `${ctx.chatId}|${ctx.sender}`;
    const sub = (ctx.args[0] || "").toLowerCase();
    const pages = pending.get(key) || [];
    if (sub === "cancel") {
      pending.delete(key);
      return ctx.reply("🗑️ The pages you collected were discarded.");
    }
    const media = ctx.findMedia({ types: ["image", "sticker", "document"] });
    const isImage = media && (media.type !== "document" || /^image\//.test(media.mimetype || ""));
    if (sub === "add") {
      if (!isImage) return ctx.reply(`Reply to a picture with ${ctx.prefix}topdf add.`);
      if (pages.length >= MAX_PAGES) return ctx.reply(`That's ${MAX_PAGES} pages already. Send ${ctx.prefix}topdf done.`);
      pages.push(await ctx.download(media, 15 * 1024 * 1024));
      pending.set(key, pages);
      return ctx.reply(`📄 Page ${pages.length} added. Add more with ${ctx.prefix}topdf add, then ${ctx.prefix}topdf done.`);
    }
    if (sub !== "done" && sub !== "") return ctx.reply(`Usage: ${ctx.prefix}topdf (on a picture) · ${ctx.prefix}topdf add · ${ctx.prefix}topdf done · ${ctx.prefix}topdf cancel`);
    if (isImage && sub === "") pages.push(await ctx.download(media, 15 * 1024 * 1024));
    if (!pages.length) return ctx.reply(`Send a picture with ${ctx.prefix}topdf as its caption, or reply to a picture with ${ctx.prefix}topdf.`);
    pending.delete(key);
    await ctx.react("📄");
    const doc = await pdf.imagesToPdf(pages);
    return ctx.reply({ document: doc, mimetype: "application/pdf", fileName: `document-${pages.length}p.pdf`, caption: `📄 PDF, ${pages.length} page${pages.length === 1 ? "" : "s"}` });
  },
};
