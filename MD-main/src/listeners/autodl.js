"use strict";

const autodl = require("../services/autodl");
const ytdlp = require("../services/ytdlp");
const { sendItems, MULTI } = require("../services/downloads");

/**
 * .autodl on: a short-video link posted in the group is downloaded and sent back.
 * Runs in the background so other messages are not held up; failures only get a ❌ reaction.
 */
module.exports = {
  name: "autodl",
  event: "message",
  phase: "post",
  priority: 40,
  groupOnly: true,
  publicOnly: true,
  requires: ["ytdlp"],
  async run(ctx) {
    if (ctx.fromMe || !/https?:\/\//i.test(ctx.body) || !autodl.isOn(ctx.state, ctx.chatId)) return undefined;
    const found = autodl.pickLink(ctx.body);
    if (!found || autodl.take(ctx.chatId)) return undefined;
    (async () => {
      try {
        await ctx.react("⏬");
        const items = await ytdlp.download(ctx.config, {
          target: found.url,
          kind: "video",
          maxItems: MULTI.has(found.site) ? autodl.MAX_ITEMS : 1,
          hasFfmpeg: ctx.app.capabilities.ffmpeg,
        });
        await sendItems(ctx, items);
        await ctx.react("✅");
      } catch (err) {
        ctx.log.debug({ err: err.message, site: found.site }, "auto download failed");
        await ctx.react("❌");
      } finally {
        autodl.release(ctx.chatId);
      }
    })();
    return undefined;
  },
};
