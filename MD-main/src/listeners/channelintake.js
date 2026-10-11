"use strict";

const channels = require("../services/channels");
const { downloadMedia, unwrap } = require("../core/media");

/** A post in a channel added with ".channel add" becomes a draft listing (services/channels.js). */
module.exports = {
  name: "channel-intake",
  event: "newsletter",
  async run(ctx, msg) {
    // Used only if a post's photo or video is encrypted (has a media key); channel media usually isn't.
    const content = unwrap(msg?.message);
    const [type, media] = content?.videoMessage ? ["video", content.videoMessage] : ["image", content?.imageMessage];
    await channels.intake(ctx, msg, { download: () => downloadMedia({ content: media, type, size: Number(media?.fileLength) || 0 }, 16 * 1024 * 1024) });
  },
};
