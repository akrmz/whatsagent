"use strict";

const { getText } = require("../../core/context");
const { findMedia, downloadMedia } = require("../../core/media");
const { at } = require("../../services/targets");

/** Re-sends the replied message (text, image, video or document) to everyone in `mentions`. */
async function forwardQuoted(ctx, mentions, captionOverride) {
  const quoted = ctx.quoted.message;
  const media = findMedia({ message: quoted }, { types: ["image", "video", "document"], quoted: false });
  if (media) {
    const buffer = await downloadMedia(media, ctx.config.limits.mediaBytes);
    const caption = captionOverride || media.content.caption || "";
    if (media.type === "image") return ctx.send({ image: buffer, caption, mentions });
    if (media.type === "video") return ctx.send({ video: buffer, caption, mentions });
    return ctx.send({ document: buffer, fileName: media.content.fileName || "file", mimetype: media.mimetype, caption, mentions });
  }
  return ctx.send({ text: captionOverride || getText(quoted) || "📢", mentions });
}

const base = { category: "admin", permission: "groupAdmin", cooldown: 30 };

module.exports = [
  {
    ...base,
    name: "tagall",
    description: "Mentions every member, one per line.",
    async run(ctx) {
      const { participants } = await ctx.groupMetadata();
      const ids = participants.map((p) => p.id);
      const header = ctx.text ? `📢 ${ctx.text}\n\n` : "🔊 *Hello everyone:*\n\n";
      return ctx.send({ text: header + ids.map(at).join("\n"), mentions: ids });
    },
  },
  {
    ...base,
    name: "tagnotadmin",
    description: "Mentions every member who is not an admin.",
    async run(ctx) {
      const { participants } = await ctx.groupMetadata();
      const ids = participants.filter((p) => !p.admin).map((p) => p.id);
      if (!ids.length) return ctx.reply("No non-admin members to tag.");
      return ctx.send({ text: `🔊 *Hello everyone:*\n\n${ids.map(at).join("\n")}`, mentions: ids });
    },
  },
  {
    ...base,
    name: "tag",
    description: "Sends your text (or re-sends the replied message) while silently mentioning everyone.",
    usage: "<text> | (reply)",
    async run(ctx) {
      const { participants } = await ctx.groupMetadata();
      const ids = participants.map((p) => p.id);
      if (ctx.quoted) return forwardQuoted(ctx, ids, ctx.text);
      return ctx.send({ text: ctx.text || "📢", mentions: ids });
    },
  },
  {
    ...base,
    name: "hidetag",
    description: "Like .tag but only mentions members who are not admins.",
    usage: "<text> | (reply)",
    async run(ctx) {
      const { participants } = await ctx.groupMetadata();
      const ids = participants.filter((p) => !p.admin).map((p) => p.id);
      if (ctx.quoted) return forwardQuoted(ctx, ids, ctx.text);
      return ctx.send({ text: ctx.text || "Tagged members (excluding admins).", mentions: ids });
    },
  },
];
