"use strict";

const re = require("../../services/realestate");
const campaigns = require("../../services/campaigns");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

const STATUS_AR = { running: "▶️ جارية", done: "✅ انتهت", stopped: "⏹️ موقوفة" };

function list(ctx) {
  const items = campaigns.all(ctx.state).slice(0, 10);
  const s = campaigns.settings(ctx.state);
  const lines = [`📣 *Campaigns* — up to ${s.perDay} messages a day, ${s.from}–${s.to}, ${s.gapMin}–${s.gapMax} s apart`];
  if (!items.length) lines.push("", `None yet. ${ctx.prefix}blast <listing> shows who a listing would go to.`);
  for (const c of items) lines.push("", `${STATUS_AR[c.status] || c.status} ${campaigns.summary(c)}${c.status === "running" ? ` · ⏳ ${c.queue.length} متبقي` : ""}`);
  if (items.some((c) => c.status === "running")) lines.push("", `Stop one: ${ctx.prefix}blast stop <number>`);
  return ctx.reply(lines.join("\n"));
}

module.exports = [
  {
    name: "blast",
    aliases: ["tarweej", "sendmatch", "hamla3qar"],
    category: "realestate",
    description:
      "حملة إرسال عقار — sends a listing to every saved client it suits (type, sale/rent, area, budget, rooms), one at a time: a random 45–90 s gap, only 10:00–21:00, at most 40 a day across all campaigns, so your number isn't flagged as spam. Clients who already got the listing or sent \"وقف\" are skipped; every message tells them how to stop. Shows the list first; \"go\" starts it. Owner and sudo users.",
    usage: "<listing> [go] | stop <campaign> | limit <per day> | hours <10:00-21:00> | list",
    examples: [".blast 12", ".blast 12 go", ".campaigns", ".blast stop 3", ".blast limit 30", ".blast hours 11:00-20:00"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      if (!sub || sub === "list" || sub === "status") return list(ctx);
      if (sub === "stop") {
        const id = idOf(arg);
        if (!id) throw new UserError(`Which campaign? ${ctx.prefix}campaigns lists them.`);
        campaigns.stop(ctx.state, id);
        return ctx.reply(`⏹️ ${campaigns.summary(campaigns.get(ctx.state, id))}\nStopped; nothing more will be sent.`);
      }
      if (sub === "limit") {
        campaigns.setLimit(ctx.state, Number(re.latinDigits(arg)));
        return ctx.reply(`✅ At most ${campaigns.settings(ctx.state).perDay} campaign messages a day.`);
      }
      if (sub === "hours") {
        campaigns.setHours(ctx.state, re.latinDigits(ctx.args.slice(1).join("")));
        const s = campaigns.settings(ctx.state);
        return ctx.reply(`✅ Campaign messages are sent between ${s.from} and ${s.to} (${ctx.config.bot.timezone}).`);
      }
      const listing = re.get(ctx.state, idOf(sub));
      if (!listing) throw new UserError(`Which listing? ${ctx.prefix}blast <listing number>, e.g. ${ctx.prefix}blast 12`);
      if (listing.status !== "available") throw new UserError(`#${listing.id} is not available (${re.STATUS_AR[listing.status]}).`);

      if (/^(go|start|yes|ابدأ|ابدا|نعم|تمام)$/.test(arg)) {
        const c = campaigns.start(ctx.state, listing, { by: ctx.sender, chat: ctx.chatId });
        const e = campaigns.estimate(ctx.state, c.total);
        return ctx.reply(`▶️ Campaign #${c.id} started: #${listing.id} to ${c.total} client(s).\n⏱️ About ${e.minutes} min of sending${e.days > 1 ? ` over ${e.days} days (daily limit)` : ""}. I'll tell you here when it's done.\n${ctx.prefix}campaigns — progress · ${ctx.prefix}blast stop ${c.id}`);
      }

      const people = campaigns.targets(ctx.state, listing);
      if (!people.length) return ctx.reply(`No client to send #${listing.id} to: none matches (${ctx.prefix}listing match ${listing.id}), or they all have it already or asked to stop.`);
      const e = campaigns.estimate(ctx.state, people.length);
      const s = campaigns.settings(ctx.state);
      const names = people.slice(0, 15).map((l) => `▫️ #${l.id} ${l.name || ""} (+${l.phone})`.trim());
      return ctx.reply(
        [
          `📣 *Campaign preview — #${listing.id}*`,
          `${listing.type || "عقار"} لل${listing.deal || "بيع"}${listing.location ? ` — ${listing.location}` : ""}`,
          "",
          `Goes to ${people.length} client(s):`,
          ...names,
          people.length > 15 ? `… and ${people.length - 15} more` : null,
          "",
          `⏱️ One message every ${s.gapMin}–${s.gapMax} s, ${s.from}–${s.to}, at most ${s.perDay} a day: about ${e.minutes} min${e.days > 1 ? ` over ${e.days} days` : ""}.`,
          `Each message ends with "${campaigns.OPT_OUT_LINE}".`,
          "",
          `Start: ${ctx.prefix}blast ${listing.id} go`,
        ]
          .filter((x) => x !== null)
          .join("\n"),
      );
    },
  },
  {
    name: "campaigns",
    aliases: ["blasts", "hamalat"],
    category: "realestate",
    description: "قائمة الحملات — your listing campaigns: running, finished and stopped, with how many were sent, failed and skipped.",
    permission: "sudo",
    cooldown: 3,
    run: list,
  },
];
