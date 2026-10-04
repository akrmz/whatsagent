"use strict";

const { getImage } = require("../../services/external");

async function groupPicture(ctx) {
  try {
    const url = await ctx.sock.profilePictureUrl(ctx.chatId, "image");
    return await getImage(url);
  } catch {
    return null;
  }
}

module.exports = {
  name: "groupinfo",
  aliases: ["infogp", "infogrupo"],
  category: "general",
  description: "Shows the group's name, ID, member count, owner, admins and description.",
  groupOnly: true,
  cooldown: 10,

  async run(ctx) {
    const meta = await ctx.groupMetadata();
    const admins = meta.participants.filter((p) => p.admin);
    const owner = meta.owner || admins.find((p) => p.admin === "superadmin")?.id;
    const text = [
      "┌──「 *GROUP INFO* 」",
      `▢ *ID:* ${meta.id}`,
      `▢ *Name:* ${meta.subject}`,
      `▢ *Members:* ${meta.participants.length}`,
      owner ? `▢ *Owner:* @${owner.split("@")[0]}` : null,
      `▢ *Admins:*\n${admins.map((a, i) => `${i + 1}. @${a.id.split("@")[0]}`).join("\n")}`,
      `▢ *Description:*\n${meta.desc?.toString() || "No description"}`,
    ]
      .filter(Boolean)
      .join("\n");
    const mentions = [...admins.map((a) => a.id), owner].filter(Boolean);
    const pic = await groupPicture(ctx);
    return ctx.send(pic ? { image: pic, caption: text, mentions } : { text, mentions });
  },
};
