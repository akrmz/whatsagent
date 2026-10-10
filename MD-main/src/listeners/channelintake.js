"use strict";

const channels = require("../services/channels");
const { downloadMedia, unwrap } = require("../core/media");

/** A post in a channel added with ".channel add" becomes a draft listing (services/channels.js). */
module.exports = {
  name: "channel-intake",
  event: "newsletter",
  async run(ctx, msg) {
    const image = unwrap(msg?.message)?.imageMessage;
    await channels.intake(ctx, msg, { download: () => downloadMedia({ content: image, type: "image", size: Number(image?.fileLength) || 0 }, 15 * 1024 * 1024) });
  },
};
