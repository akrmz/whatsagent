"use strict";

const { files, groupData } = require("../../services/settings");

const onOff = (v) => (v ? "ON" : "OFF");

module.exports = {
  name: "settings",
  category: "owner",
  description: "Shows the bot's global settings and, in a group, that group's protection settings.",
  permission: "sudo",

  async run(ctx) {
    const s = ctx.state;
    const g = groupData(s).data;
    const lines = [
      "*BOT SETTINGS*",
      "",
      `• Mode: ${s.isPublic() ? "Public" : "Private"}`,
      `• Auto status: ${onOff(files.autoStatus(s).data.enabled)} (react: ${onOff(files.autoStatus(s).data.reactOn)})`,
      `• Auto-read: ${onOff(files.autoread(s).data.enabled)}`,
      `• Auto-typing: ${onOff(files.autotyping(s).data.enabled)}`,
      `• PM blocker: ${onOff(files.pmblocker(s).data.enabled)}`,
      `• Anticall: ${onOff(files.anticall(s).data.enabled)}`,
      `• Antidelete: ${onOff(files.antidelete(s).data.enabled)}`,
      `• Auto-reaction: ${onOff(g.autoReaction)}`,
      `• Mention reply: ${onOff(files.mention(s).data.enabled)}`,
    ];
    if (ctx.isGroup) {
      const id = ctx.chatId;
      const rule = (key) => (g[key][id]?.enabled ? `ON (${g[key][id].action || "delete"})` : "OFF");
      lines.push(
        "",
        "*This group*",
        `• Antilink: ${rule("antilink")}`,
        `• Antibadword: ${rule("antibadword")}`,
        `• Antitag: ${rule("antitag")}`,
        `• Welcome: ${onOff(g.welcome[id]?.enabled)}`,
        `• Goodbye: ${onOff(g.goodbye[id]?.enabled)}`,
        `• Chatbot: ${onOff(g.chatbot[id])}`,
      );
    }
    return ctx.reply(lines.join("\n"));
  },
};
