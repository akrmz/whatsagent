"use strict";

const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const { stopAll } = require("../../services/automations");
const { overview: list } = require("../../services/autosoverview");

const overview = (ctx) => list(ctx.state, ctx.chatId, ctx.prefix);

module.exports = {
  name: "autos",
  aliases: ["automations", "scheduled", "auto"],
  category: "tools",
  description: "كل ما يعمل تلقائياً في هذه المحادثة في قائمة واحدة، و\".autos off\" لإيقاف الرسائل الإسلامية التلقائية كلها — lists everything automatic in this chat; \".autos off\" stops all automatic Islamic posts here.",
  usage: "[off]",
  examples: [".autos", ".autos off"],
  cooldown: 5,
  async run(ctx) {
    if ((ctx.args[0] || "").toLowerCase() === "off") {
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      stopAll(ctx.state, ctx.chatId);
      const rest = overview(ctx);
      return ctx.reply(`⏹️ أُوقفت الأذكار والتنبيهات والآيات والأحاديث والورد وتذكيرات الجمعة والصيام هنا.${rest.length ? `\n\nما زال يعمل (يديره المشرفون):\n${rest.join("\n")}` : ""}`);
    }
    const lines = overview(ctx);
    if (!lines.length) return ctx.reply(`لا يوجد شيء تلقائي في هذه المحادثة.\nأمثلة: ${ctx.prefix}autoazkar on · ${ctx.prefix}autotafsir every 3 · ${ctx.prefix}autowird on 2 20:00`);
    return ctx.reply(`⚙️ *التلقائي في هذه المحادثة*\n\n${lines.join("\n")}\n\n${zoneLine(ctx)}\n\n${ctx.prefix}autos off لإيقاف الرسائل الإسلامية التلقائية كلها`);
  },
};
