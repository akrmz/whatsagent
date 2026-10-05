"use strict";

const { getBuffer } = require("../../core/http");
const { at } = require("../../services/targets");

module.exports = {
  name: "getpp",
  aliases: ["pp", "avatar", "pfp"],
  category: "tools",
  description: 'Sends the profile picture of the person you mention or reply to (or yours). Add "group" for the group photo.',
  usage: "[@user | reply | group]",
  examples: [".getpp @someone", ".getpp", ".getpp group"],
  cooldown: 10,

  async run(ctx) {
    const explicit = ctx.target();
    const jid = explicit || (ctx.isGroup && /^group$/i.test(ctx.text) ? ctx.chatId : ctx.sender);
    let url;
    try {
      url = await ctx.sock.profilePictureUrl(jid, "image");
    } catch {
      url = null;
    }
    const who = jid === ctx.chatId ? "This group" : at(jid);
    if (!url) return ctx.reply({ text: `${who} has no profile picture, or it is only visible to their contacts.`, mentions: [jid] });
    // Download it ourselves (https only, size-capped) and send the bytes.
    const { buffer } = await getBuffer(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 20000 });
    return ctx.reply({ image: buffer, caption: `🖼️ ${who}`, mentions: [jid] });
  },
};
