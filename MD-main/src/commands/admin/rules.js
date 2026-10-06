"use strict";

const notes = require("../../services/notes");
const { getText } = require("../../core/context");

/** Group rules are the note called "rules" (also shown by #rules and {rules} in .welcome). */
module.exports = [
  {
    name: "rules",
    aliases: ["grouprules", "qawanin"],
    category: "admin",
    description: "Shows this group's rules (set by admins with .setrules; also #rules). Without rules set, shows the group description.",
    groupOnly: true,
    cooldown: 10,
    async run(ctx) {
      const n = notes.get(ctx.state, ctx.chatId, "rules");
      if (n) return ctx.reply(`📜 *قوانين المجموعة · Group rules*\n\n${n.text}`);
      const meta = await ctx.app.groups.get(ctx.sock, ctx.chatId).catch(() => null);
      const desc = meta?.desc?.toString().trim();
      if (desc) return ctx.reply(`📜 *وصف المجموعة · Group description*\n\n${desc}`);
      return ctx.reply(`No rules are set for this group. Admins: ${ctx.prefix}setrules <text>`);
    },
  },
  {
    name: "setrules",
    aliases: ["addrules"],
    category: "admin",
    description: "Sets this group's rules (text, or reply to a message). Members see them with .rules or #rules; add {rules} to the .welcome message to greet new members with them.",
    usage: "<rules text> (or reply to a message)",
    examples: [".setrules 1. Be respectful\n2. No spam or ads\n3. Stay on topic", "(reply to a message) .setrules"],
    permission: "groupAdmin",
    groupOnly: true,
    cooldown: 5,
    async run(ctx) {
      const text = ctx.text || (ctx.quoted ? getText(ctx.quoted.message) : "");
      if (!text) return ctx.reply(`Usage: ${ctx.prefix}setrules <text>, or reply to a message with ${ctx.prefix}setrules`);
      const { replaced } = notes.save(ctx.state, ctx.chatId, "rules", text, ctx.sender);
      return ctx.reply(`📜 Rules ${replaced ? "updated" : "saved"}. Members: ${ctx.prefix}rules or #rules. Tip: add {rules} to ${ctx.prefix}welcome set …`);
    },
  },
  {
    name: "delrules",
    aliases: ["clearrules"],
    category: "admin",
    description: "Removes this group's rules.",
    permission: "groupAdmin",
    groupOnly: true,
    cooldown: 5,
    async run(ctx) {
      return ctx.reply(notes.remove(ctx.state, ctx.chatId, "rules") ? "🗑️ Rules removed." : "No rules were set.");
    },
  },
];
