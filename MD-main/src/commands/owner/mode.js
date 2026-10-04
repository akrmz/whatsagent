"use strict";

module.exports = {
  name: "mode",
  category: "owner",
  description: "Public: everyone can use commands. Private: only owner and sudo (group moderation keeps working).",
  usage: "public | private",
  permission: "owner",

  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    if (sub === "public" || sub === "private") {
      ctx.state.setPublic(sub === "public");
      return ctx.reply(`✅ Bot is now in *${sub}* mode.`);
    }
    const current = ctx.state.isPublic() ? "public" : "private";
    return ctx.reply(`Current mode: *${current}*\n\n${ctx.prefix}mode public – everyone\n${ctx.prefix}mode private – owner and sudo only`);
  },
};
