"use strict";

const { getJson, getBuffer } = require("../../core/http");
const { toSticker } = require("../../core/media");
const { stickerOptions } = require("../../services/stickers");

const MAX_STICKERS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  name: "tg",
  aliases: ["stickertelegram", "tgsticker", "telesticker"],
  category: "sticker",
  description: `Copies a public Telegram sticker pack (up to ${MAX_STICKERS} stickers; animated .tgs stickers are skipped).`,
  usage: "<https://t.me/addstickers/NAME>",
  examples: [".tg https://t.me/addstickers/Animals"],
  cooldown: 120,
  requires: ["telegramBot", "ffmpeg"],
  externalService: "api.telegram.org (with your own bot token)",

  async run(ctx) {
    const m = ctx.text.match(/^https:\/\/t\.me\/addstickers\/([A-Za-z0-9_]{1,64})$/);
    if (!m) return ctx.reply(`⚠️ Give a Telegram sticker pack link, e.g. ${ctx.prefix}tg https://t.me/addstickers/Animals`);
    const api = `https://api.telegram.org/bot${ctx.config.keys.telegramBot}`;
    const set = await getJson(`${api}/getStickerSet?name=${m[1]}`);
    if (!set.ok) return ctx.reply("❌ Sticker pack not found or not public.");
    const stickers = set.result.stickers.filter((s) => !s.is_animated).slice(0, MAX_STICKERS);
    await ctx.reply(`📦 Found ${set.result.stickers.length} stickers, sending ${stickers.length}…`);
    let sent = 0;
    for (const s of stickers) {
      try {
        const file = await getJson(`${api}/getFile?file_id=${encodeURIComponent(s.file_id)}`);
        if (!file.ok || !/^[\w/.-]+$/.test(file.result.file_path)) continue;
        const { buffer } = await getBuffer(`https://api.telegram.org/file/bot${ctx.config.keys.telegramBot}/${file.result.file_path}`, {
          maxBytes: 3 * 1024 * 1024,
        });
        const sticker = await toSticker(buffer, { ...stickerOptions(ctx), animated: Boolean(s.is_video), emojis: s.emoji ? [s.emoji] : undefined });
        await ctx.send({ sticker });
        sent++;
        await sleep(1000);
      } catch (err) {
        ctx.log.debug({ err: err.message }, "telegram sticker skipped");
      }
    }
    return ctx.reply(`✅ Sent ${sent}/${stickers.length} stickers.`);
  },
};
