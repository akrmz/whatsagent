"use strict";

module.exports = {
  name: "staff",
  aliases: ["admins", "listadmin"],
  category: "general",
  description: "Lists the group admins.",
  groupOnly: true,
  cooldown: 10,

  async run(ctx) {
    const meta = await ctx.groupMetadata();
    const admins = meta.participants.filter((p) => p.admin);
    const list = admins.map((a, i) => `▢ ${i + 1}. @${a.id.split("@")[0]}`).join("\n");
    return ctx.send({ text: `≡ *GROUP ADMINS* _${meta.subject}_\n\n${list}`, mentions: admins.map((a) => a.id) });
  },
};
