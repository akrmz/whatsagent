"use strict";

const re = require("../../services/realestate");
const statuspost = require("../../services/statuspost");
const autolistings = require("../../services/autolistings");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const S = statuspost.STATUS_JID;

module.exports = {
  name: "statuspost",
  aliases: ["hala", "tostatus", "storypost"],
  category: "realestate",
  description:
    "نشر على الحالة — posts a listing to your WhatsApp Status as its 9:16 design (.story) with a short caption. It's shown to your saved clients who have your number saved (not those who sent وقف; at most 1,000, most recent first). \"daily 09:00\" posts one available listing every day, going round the catalogue (add a search to post only some). Owner and sudo users.",
  usage: "<listing> | daily <time> [search] | now | off",
  examples: [".statuspost 12", ".statuspost daily 09:00", ".statuspost daily 20:00 شقة التجمع", ".statuspost off"],
  permission: "sudo",
  cooldown: 10,
  async run(ctx) {
    const [sub = ""] = ctx.args.map((a) => a.toLowerCase());
    const entry = autolistings.get(ctx.state, S);
    if (!sub) {
      const who = statuspost.audience(ctx.state, []).length;
      return ctx.reply(
        `📲 *Status posts*\nDaily: ${entry ? `on at ${entry.time}${entry.query ? ` (${entry.query})` : ""}` : "off"}\nAudience: ${who} saved client(s) with a number\n\n${ctx.prefix}statuspost <listing> — post now\n${ctx.prefix}statuspost daily 09:00 [search] · ${ctx.prefix}statuspost off`,
      );
    }
    if (sub === "off") {
      autolistings.remove(ctx.state, S);
      return ctx.reply("🔕 No more daily status posts.");
    }
    if (sub === "daily" || sub === "يومي") {
      const time = re.latinDigits(ctx.args[1] || "");
      if (parseClock(time) === null) throw new UserError(`At what time? ${ctx.prefix}statuspost daily 09:00 [search]`);
      const query = ctx.args.slice(2).join(" ");
      autolistings.set(ctx.state, S, { time, query });
      const n = autolistings.next(ctx.state, { query });
      return ctx.reply(`📲 Every day at ${time} a listing goes to your status${query ? ` (only ${query})` : ""}, going round your catalogue.${n ? `\nNext: #${n.id}` : "\n⚠️ No available listing matches right now."}`);
    }
    const listing = sub === "now" ? autolistings.next(ctx.state, entry || {}) : re.get(ctx.state, idOf(sub));
    if (!listing) throw new UserError(sub === "now" ? "No available listing to post." : `Which listing? ${ctx.prefix}statuspost 12`);
    await ctx.react("📲");
    let shown;
    try {
      shown = await statuspost.post(ctx.app, listing);
    } catch (err) {
      if (/no saved clients/.test(err.message)) throw new UserError(`No saved client with a number to show it to yet (${ctx.prefix}lead add).`);
      throw err;
    }
    if (sub === "now" && entry) autolistings.markPosted(ctx.state, S, listing.id);
    return ctx.reply(`📲 #${listing.id} is on your status, for ${shown} saved client(s). WhatsApp shows it to those who have your number saved.`);
  },
};
