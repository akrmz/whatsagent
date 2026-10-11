"use strict";

const drafts = require("../services/drafts");
const img = require("../services/reimages");
const listingmedia = require("../services/listingmedia");
const re = require("../services/realestate");
const requests = require("../services/requests");
const { getContextInfo } = require("../core/context");

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Units forwarded to the bot: the owner (or a sudo user), in their own chat with the bot,
 * forwards a post with its photos (from a broker's group, a channel, another chat). They are
 * collected into a draft (.drafts) and shown back for a check 2 minutes after the last one.
 *   - a forwarded text that reads as a property starts a draft (or the next one);
 *   - forwarded photos and videos always join (an album is one message per photo);
 *   - while a draft is collecting, photos and lines typed by hand join it too ("السعر 3 مليون").
 * Only in that private chat, so other people's messages never become drafts. ".drafts off" stops it.
 */
module.exports = {
  name: "forward-intake",
  event: "message",
  phase: "post",
  priority: 11,
  async run(ctx) {
    if (ctx.isGroup || !ctx.isSudoOrOwner) return undefined;
    if (ctx.chatId !== ctx.sender && ctx.chatId !== ctx.botJid) return undefined; // their own chat with the bot only
    if (drafts.isOff(ctx.state)) return undefined;
    const forwarded = Boolean(getContextInfo(ctx.content)?.isForwarded);
    const media = ctx.findMedia({ types: ["image", "video"], quoted: false });
    const key = `fwd:${ctx.chatId}`;
    const collecting = drafts.open(ctx.state).some((d) => d.source.key === key && !d.reviewed && Date.now() - d.updated < drafts.IDLE);
    const text = ctx.body;
    // A unit on offer, not a client's request ("عايز شقة …", forwarded to add them as a client).
    const looksLikeUnit = (t) => {
      if (requests.detect(t.length <= 300 ? t : "")) return false;
      const f = re.parseListingText(t);
      return Boolean(f.type || f.price);
    };
    if (!forwarded && !collecting) return undefined;
    if (!media && !text) return undefined;
    if (!media && forwarded && !collecting && !looksLikeUnit(text)) return undefined; // a forwarded chat message, not a post

    let jpeg = null;
    let video = null;
    if (media?.type === "video") {
      // Kept as sent (a listing's video: MP4/MOV, at most 16 MB), checked by its file signature.
      if (media.size > listingmedia.MAX_VIDEO_BYTES) {
        await ctx.reply(`🎥 الفيديو ده أكبر من ${listingmedia.MAX_VIDEO_BYTES / 1048576} ميجا، مش هيتحفظ مع الوحدة.`);
        return "stop";
      }
      try {
        video = await ctx.download(media, listingmedia.MAX_VIDEO_BYTES);
        listingmedia.checkVideo(video);
      } catch (err) {
        ctx.log.warn({ err: err.message }, "forwarded video not kept");
        video = null;
      }
    } else if (media) {
      try {
        jpeg = await img.toListingJpeg(await ctx.download(media, MAX_BYTES));
      } catch (err) {
        ctx.log.warn({ err: err.message }, "forwarded photo not kept");
      }
    }
    const r = drafts.collect(ctx.state, ctx.config, {
      source: { kind: "forward", key, notify: ctx.chatId },
      text,
      jpeg,
      video,
      by: ctx.sender,
      ownerNumber: ctx.config.owners.numbers[0],
    });
    if (r.full) {
      await ctx.reply(`📥 ${drafts.MAX_OPEN} drafts are already waiting. Save or delete some first: ${ctx.prefix}drafts`);
      return "stop";
    }
    if (r.skipped === "photos" || r.skipped === "videos") {
      await ctx.react("✋");
      if (r.skipped === "videos") await ctx.reply(`🎥 الوحدة دي معاها ${drafts.MAX_DRAFT_VIDEOS} فيديو خلاص (أو المسودات كلها معاها ${drafts.MAX_STORED_VIDEOS}).`);
      return "stop";
    }
    if (!r.draft) return undefined;
    await ctx.react("📥");
    if (r.isNew) await ctx.reply(`📥 بجمّع الوحدة في مسودة #${r.draft.id}… ابعت باقي صورها، وبعد دقيقتين من آخر رسالة هبعتهالك تراجعها.\n(${ctx.prefix}drafts off لو مش عايز ده)`);
    return "stop";
  },
};
