"use strict";

module.exports = {
  name: "vv",
  category: "owner",
  description: "Reveals the view-once photo or video you reply to (owner only, to protect other people's privacy).",
  usage: "(reply to a view-once message)",
  permission: "owner",

  async run(ctx) {
    const media = ctx.findMedia({ types: ["image", "video"], own: false });
    if (!media || !media.viewOnce) return ctx.reply("❌ Reply to a view-once image or video.");
    const buffer = await ctx.download(media);
    const caption = media.content.caption || "";
    return ctx.reply(media.type === "image" ? { image: buffer, caption } : { video: buffer, caption });
  },
};
