"use strict";

const notes = require("../../services/notes");
const { getText } = require("../../core/context");

/** In groups only admins (and owner/sudo) change notes; in a private chat they are yours. */
async function canEdit(ctx) {
  if (!ctx.isGroup || ctx.isSudoOrOwner) return true;
  return ctx.isSenderAdmin();
}

module.exports = [
  {
    name: "save",
    aliases: ["savenote", "addnote"],
    category: "tools",
    description: "Saves a note in this chat (rules, links, FAQ …). Anyone can then send #name to see it. In groups, only admins can save.",
    usage: "<name> <text> (or reply to a message)",
    examples: [".save rules Be kind. No spam.", "(reply to a message) .save wifi"],
    cooldown: 3,
    async run(ctx) {
      const [name] = ctx.args;
      if (!name) return ctx.reply(`Usage: ${ctx.prefix}save <name> <text>, or reply to a message with ${ctx.prefix}save <name>`);
      if (!(await canEdit(ctx))) return ctx.reply("Only group admins can save notes here.");
      const text = ctx.text.slice(name.length).trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");
      const { key, replaced } = notes.save(ctx.state, ctx.chatId, name, text, ctx.sender);
      return ctx.reply(`📌 Note *#${key}* ${replaced ? "updated" : "saved"}. Send #${key} to show it.`);
    },
  },
  {
    name: "note",
    aliases: ["getnote"],
    category: "tools",
    description: "Shows a saved note (same as sending #name).",
    usage: "<name>",
    examples: [".note rules", "#rules"],
    cooldown: 3,
    async run(ctx) {
      if (!ctx.args[0]) return ctx.reply(`Usage: ${ctx.prefix}note <name>  ·  list: ${ctx.prefix}notes`);
      const n = notes.get(ctx.state, ctx.chatId, ctx.args[0]);
      return ctx.reply(n ? n.text : `No note #${notes.normalize(ctx.args[0])} here. See ${ctx.prefix}notes`);
    },
  },
  {
    name: "notes",
    aliases: ["listnotes"],
    category: "tools",
    description: "Lists the notes saved in this chat.",
    cooldown: 5,
    async run(ctx) {
      const names = notes.list(ctx.state, ctx.chatId);
      if (!names.length) return ctx.reply(`No notes here yet. Save one: ${ctx.prefix}save <name> <text>`);
      return ctx.reply(`📌 *Notes* (${names.length})\n\n${names.map((n) => `#${n}`).join("  ")}\n\nSend #name to show one.`);
    },
  },
  {
    name: "delnote",
    aliases: ["rmnote", "clearnote"],
    category: "tools",
    description: "Deletes a saved note. In groups, only admins can.",
    usage: "<name>",
    cooldown: 3,
    async run(ctx) {
      if (!ctx.args[0]) return ctx.reply(`Usage: ${ctx.prefix}delnote <name>`);
      if (!(await canEdit(ctx))) return ctx.reply("Only group admins can delete notes here.");
      const ok = notes.remove(ctx.state, ctx.chatId, ctx.args[0]);
      return ctx.reply(ok ? `🗑️ Note #${notes.normalize(ctx.args[0])} deleted.` : "There is no such note.");
    },
  },
];
