"use strict";

const grouppick = require("../../services/grouppick");
const { runIn } = require("../../services/remoterun");
const { UserError } = require("../../core/errors");

const MAX_GROUPS = 20;
const POST = /^(post|publish|نشر|انشر)$/i;

module.exports = {
  name: "in",
  aliases: ["ingroup", "ingc"],
  category: "owner",
  description:
    "Runs a command in a group from your private chat, as if you had sent it there, so you set up a group without writing in it: daily azkar, the listing of the day, hadith, the Quran wird, schedules, welcome messages and so on. Name the group by its number in .groups or its ID (120363…@g.us), or several separated by commas. Its replies (the confirmations) come back to you, labelled with the group’s name; what it posts (the first hadith, the listing of the day) goes to the group, as do the scheduled posts it sets up. With “post”, its replies go to the group too (a hadith or a listing now). Owner only, from a private chat.",
  usage: "<group number | group ID>[,more] [post] <command>",
  examples: [".groups", ".in 1 autoazkar on", ".in 1,2,3 autohadith every 6", ".in 2 autolistings on 10:00 شقة التجمع", ".in 120363000000000001@g.us autowird on 2 06:00", ".in 1 post hadith", ".in 4 autoazkar"],
  permission: "owner",
  privateOnly: true,
  cooldown: 2,
  async run(ctx) {
    const p = ctx.prefix;
    const m = ctx.text.match(/^(\S+)\s+([\s\S]+)$/);
    if (!m) return ctx.reply(`Usage: ${p}in <group number or ID> <command>, e.g. ${p}in 1 autoazkar on\nThe group numbers and IDs: ${p}groups`);
    let rest = m[2].trim();
    const first = rest.split(/\s+/)[0];
    const post = POST.test(first) && rest.split(/\s+/).length > 1;
    if (post) rest = rest.slice(first.length).trim();

    const tokens = [...new Set(m[1].split(/[,،]/).map((t) => t.trim()).filter(Boolean))];
    if (tokens.length > MAX_GROUPS) throw new UserError(`At most ${MAX_GROUPS} groups at once.`);
    const ids = [];
    for (const t of tokens) {
      const id = await grouppick.resolve(ctx, t);
      if (!id) throw new UserError(`"${t}" isn't a group number from ${p}groups or a group ID (120363…@g.us).`);
      if (!ids.includes(id)) ids.push(id);
    }

    const done = [];
    for (const id of ids) {
      try {
        const r = await runIn(ctx, id, rest, { post });
        done.push(`✅ ${r.subject}${r.posted ? ` · ${r.posted} posted in the group` : ""}${r.answers || r.posted ? "" : " (no answer)"}`);
      } catch (err) {
        if (!(err instanceof UserError)) throw err;
        if (ids.length === 1) throw err;
        done.push(`❌ ${id}: ${err.message}`);
      }
    }
    // One group: its answer (above) is enough, unless it gave none. Several: a summary.
    if (ids.length > 1 || done[0].endsWith("(no answer)")) return ctx.reply(`▶️ ${p}${rest.replace(/^\./, "").split(/\s+/)[0]} in ${ids.length} group(s):\n${done.join("\n")}`);
    return undefined;
  },
};
