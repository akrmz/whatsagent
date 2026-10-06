"use strict";

const { getText } = require("../core/context");

/**
 * Shared by the download commands and the automatic downloader (.autodl):
 *   - the link: in the message itself, or in the message it replies to
 *   - sending: each item by its real type (a photo in an X/Reddit post is sent as a photo)
 */

/** The text to look for a link in: the command text, else the replied-to message. */
function linkText(ctx) {
  if (/https?:\/\//i.test(ctx.text || "")) return ctx.text;
  return ctx.quoted ? getText(ctx.quoted.message) : ctx.text || "";
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp"]);
const AUDIO_EXTS = new Set(["mp3", "m4a", "ogg", "opus"]);

/** Sends downloaded items; only the first one gets the caption. */
async function sendItems(ctx, items, { audio = false, quoted = true } = {}) {
  const send = (payload) => (quoted ? ctx.reply(payload) : ctx.send(payload));
  for (const [i, item] of items.entries()) {
    const caption = i === 0 && item.title && item.title !== "media" ? `📝 ${item.title.slice(0, 200)}` : undefined;
    if (audio || AUDIO_EXTS.has(item.ext)) await send({ audio: item.buffer, mimetype: "audio/mpeg", fileName: `${(item.title || "audio").slice(0, 60)}.mp3` });
    else if (IMAGE_EXTS.has(item.ext)) await send({ image: item.buffer, caption });
    else await send({ video: item.buffer, mimetype: "video/mp4", caption });
  }
}

// Sites whose posts can contain several videos.
const MULTI = new Set(["instagram", "twitter", "threads", "reddit"]);

module.exports = { linkText, sendItems, IMAGE_EXTS, MULTI };
