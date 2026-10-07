"use strict";

const notes = require("../services/notes");
const { allowLookup } = require("../services/lookuplimits");

/** "#rules" shows the note called "rules" saved in this chat with .save. */
module.exports = {
  name: "notes",
  event: "message",
  phase: "post",
  priority: 20,
  publicOnly: true,
  async run(ctx) {
    const m = ctx.body.trim().match(/^#([\p{L}\p{N}_-]{1,30})$/u);
    if (!m) return undefined;
    const note = notes.get(ctx.state, ctx.chatId, m[1]);
    if (!note) return undefined;
    // Over the limit: silent, but still handled (nothing else answers it either).
    if (allowLookup(ctx, `note:${notes.normalize(m[1])}`)) await ctx.reply(note.text);
    return "stop";
  },
};
