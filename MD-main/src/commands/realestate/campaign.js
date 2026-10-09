"use strict";

const re = require("../../services/realestate");
const campaigns = require("../../services/campaigns");
const img = require("../../services/reimages");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

const STATUS_AR = { running: "▶️ جارية", done: "✅ انتهت", stopped: "⏹️ موقوفة" };

// ---- ".blast msg": an occasion greeting or an announcement to clients ----------------------

const MSG = /^(msg|message|رسالة|رساله|تهنئة|تهنئه)$/;
const GO = /^(go|start|yes|ابدأ|ابدا|نعم|تمام)$/;
const DRAFT_FOR = 15 * 60 * 1000;
const drafts = new Map(); // sender → { text, audience, image?: Buffer, at } — in memory, until "go"

/**
 * ".blast msg [filters]\n<message>" previews who gets it and how it reads; ".blast msg go" sends
 * it through the campaign queue. On one line, it is all message (no filters). A picture sent
 * with it, or replied to, goes with the message.
 */
async function messageCampaign(ctx, arg) {
  const p = ctx.prefix;
  if (GO.test(arg)) {
    const d = drafts.get(ctx.sender);
    if (!d || Date.now() - d.at > DRAFT_FOR) throw new UserError(`Nothing to send: write the message first (${p}blast msg …), then ${p}blast msg go within 15 minutes.`);
    let image;
    if (d.image) {
      image = `${crypto.randomUUID()}.jpg`;
      fs.mkdirSync(path.dirname(campaigns.imagePath(ctx.config, image)), { recursive: true });
      fs.writeFileSync(campaigns.imagePath(ctx.config, image), d.image);
    }
    let c;
    try {
      c = campaigns.startMessage(ctx.state, { by: ctx.sender, chat: ctx.chatId, text: d.text, image, audience: d.audience });
    } catch (err) {
      if (image) campaigns.dropImage(ctx.config, { image });
      throw err;
    }
    drafts.delete(ctx.sender);
    const e = campaigns.estimate(ctx.state, c.total);
    return ctx.reply(`▶️ Message #${c.id} started: ${c.total} client(s).\n⏱️ About ${e.minutes} min of sending${e.days > 1 ? ` over ${e.days} days (daily limit)` : ""}. I'll tell you here when it's done.\n${p}campaigns — progress · ${p}blast stop ${c.id}`);
  }

  const body = ctx.text.replace(/^\s*\S+/, ""); // after "msg"
  const [first, ...rest] = body.replace(/^[ \t]+/, "").split("\n");
  const [filters, text] = rest.join("\n").trim() ? [first, rest.join("\n").trim()] : ["", first.trim()];
  if (!text) {
    return ctx.reply(
      [
        "✉️ *A message to your clients* — an occasion greeting or an announcement, paced like campaigns.",
        "",
        `${p}blast msg`,
        "كل سنة وانت طيب يا {name} 🌙 رمضان كريم",
        "",
        `Only some clients: write filters on the first line, the message below:`,
        `${p}blast msg التجمع شقة`,
        "عندنا وحدات جديدة في التجمع الخامس …",
        "",
        "Filters: a status (new, viewing, negotiating, won …), a type (شقة …), بيع/إيجار, area words, or all (lost clients too). {name} becomes each client's name. Send it with a picture (or reply to one) to attach it.",
      ].join("\n"),
    );
  }
  if (text.length > campaigns.MAX_MESSAGE) throw new UserError(`The message is at most ${campaigns.MAX_MESSAGE} characters (this one has ${text.length}).`);
  const audience = campaigns.parseAudience(filters);
  const people = campaigns.messageTargets(ctx.state, audience);
  if (!people.length) throw new UserError(`No client matches (${campaigns.audienceText(audience)}), with a number and without a stop request.`);

  let image;
  const media = ctx.findMedia({ types: ["image"] });
  if (media) image = await img.toListingJpeg(await ctx.download(media, 15 * 1024 * 1024));
  drafts.set(ctx.sender, { text, audience, image, at: Date.now() });

  const e = campaigns.estimate(ctx.state, people.length);
  const s = campaigns.settings(ctx.state);
  return ctx.reply(
    [
      `✉️ *Message preview* — ${campaigns.audienceText(audience)}`,
      "",
      `Goes to ${people.length} client(s):`,
      ...people.slice(0, 15).map((l) => `▫️ #${l.id} ${l.name || ""} (+${l.phone})`.trim()),
      people.length > 15 ? `… and ${people.length - 15} more` : null,
      "",
      `${image ? "🖼️ With the picture. " : ""}#${people[0].id} reads:`,
      "┈┈┈┈┈┈┈┈",
      campaigns.messageText(people[0], text),
      "┈┈┈┈┈┈┈┈",
      `⏱️ One every ${s.gapMin}–${s.gapMax} s, ${s.from}–${s.to}, at most ${s.perDay} a day: about ${e.minutes} min${e.days > 1 ? ` over ${e.days} days` : ""}.`,
      "",
      `Send it: ${p}blast msg go (within 15 minutes)`,
    ]
      .filter((x) => x !== null)
      .join("\n"),
  );
}

function list(ctx) {
  const items = campaigns.all(ctx.state).slice(0, 10);
  const s = campaigns.settings(ctx.state);
  const lines = [`📣 *Campaigns* — up to ${s.perDay} messages a day, ${s.from}–${s.to}, ${s.gapMin}–${s.gapMax} s apart`];
  if (!items.length) lines.push("", `None yet. ${ctx.prefix}blast <listing> shows who a listing would go to.`);
  const tz = ctx.config.bot.timezone;
  const hhmm = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  for (const c of items) {
    const waiting = c.status === "running" && c.startAt > Date.now() ? ` · 🕒 يبدأ ${hhmm(c.startAt)}` : "";
    lines.push("", `${STATUS_AR[c.status] || c.status} ${campaigns.summary(c)}${c.status === "running" ? ` · ⏳ ${c.queue.length} متبقي` : ""}${waiting}`);
  }
  if (items.some((c) => c.status === "running")) lines.push("", `Stop one: ${ctx.prefix}blast stop <number>`);
  return ctx.reply(lines.join("\n"));
}

module.exports = [
  {
    name: "blast",
    clientData: true,
    aliases: ["tarweej", "sendmatch", "hamla3qar"],
    category: "realestate",
    description:
      "حملة إرسال عقار — sends a listing to every saved client it suits (type, sale/rent, area, budget, rooms), one at a time: a random 45–90 s gap, only 10:00–21:00, at most 40 a day across all campaigns, so your number isn't flagged as spam. Clients who already got the listing or sent \"وقف\" are skipped; every message tells them how to stop. Shows the list first; \"go\" starts it. \"drop\" after a price cut tells every client the new price fits, including those who had it before (once per price). \"msg\" sends your own message (an occasion greeting, an announcement, optionally with a picture) to all clients or a filtered group, the same paced way. Owner and sudo users.",
    usage: "<listing> [go] | <listing> drop [go] | msg [filters] (new line) <message> | msg go | stop <campaign> | limit <per day> | hours <10:00-21:00> | list",
    examples: [".blast 12", ".blast 12 go", ".blast 12 drop", ".blast 12 drop go", ".blast msg\nكل سنة وانت طيب يا {name} 🌙", ".blast msg التجمع شقة\nعندنا وحدات جديدة في التجمع", ".blast msg go", ".campaigns", ".blast stop 3", ".blast limit 30", ".blast hours 11:00-20:00"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      if (!sub || sub === "list" || sub === "status") return list(ctx);
      if (sub === "stop") {
        const id = idOf(arg);
        if (!id) throw new UserError(`Which campaign? ${ctx.prefix}campaigns lists them.`);
        campaigns.stop(ctx.state, id);
        campaigns.dropImage(ctx.config, campaigns.get(ctx.state, id));
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
      if (MSG.test(sub)) return messageCampaign(ctx, arg);
      const listing = re.get(ctx.state, idOf(sub));
      if (!listing) throw new UserError(`Which listing? ${ctx.prefix}blast <listing number>, e.g. ${ctx.prefix}blast 12`);
      if (listing.status !== "available") throw new UserError(`#${listing.id} is not available (${re.STATUS_AR[listing.status]}).`);

      // ".blast 12 drop [go]": tell clients the listing now fits about its new price.
      const mode = /^(drop|تخفيض|خصم)$/.test(arg) ? "drop" : undefined;
      const goWord = mode ? String(ctx.args[2] || "").toLowerCase() : arg;
      const cut = mode && re.discount(listing);
      if (mode && !cut) throw new UserError(`#${listing.id} has no price cut in the last 30 days. Lower it first: ${ctx.prefix}listing edit ${listing.id} السعر: …`);
      if (/^(go|start|yes|ابدأ|ابدا|نعم|تمام)$/.test(goWord)) {
        const c = campaigns.start(ctx.state, listing, { by: ctx.sender, chat: ctx.chatId, mode });
        const e = campaigns.estimate(ctx.state, c.total);
        return ctx.reply(`▶️ ${mode ? "Price-drop campaign" : "Campaign"} #${c.id} started: #${listing.id} to ${c.total} client(s).\n⏱️ About ${e.minutes} min of sending${e.days > 1 ? ` over ${e.days} days (daily limit)` : ""}. I'll tell you here when it's done.\n${ctx.prefix}campaigns — progress · ${ctx.prefix}blast stop ${c.id}`);
      }

      const people = campaigns.targets(ctx.state, listing, mode);
      if (!people.length) {
        return ctx.reply(
          mode
            ? `No client to tell about #${listing.id}'s new price: none fits it within budget (${ctx.prefix}listing match ${listing.id}), or they were all told already.`
            : `No client to send #${listing.id} to: none matches (${ctx.prefix}listing match ${listing.id}), or they all have it already or asked to stop.`,
        );
      }
      if (mode) {
        const had = people.filter((l) => (l.sentListings || []).includes(listing.id)).length;
        const s = campaigns.settings(ctx.state);
        const e = campaigns.estimate(ctx.state, people.length);
        return ctx.reply(
          [
            `📉 *Price-drop preview — #${listing.id}*: ${re.shortAr(cut.was)} → ${re.shortAr(listing.price)} (−${cut.pct}%)`,
            "",
            `Goes to ${people.length} client(s) it now fits within budget${had ? ` (${had} got it before at the old price)` : ""}:`,
            ...people.slice(0, 15).map((l) => `▫️ #${l.id} ${l.name || ""} (+${l.phone})${(l.sentListings || []).includes(listing.id) ? " — had it before" : ""}`.trim()),
            people.length > 15 ? `… and ${people.length - 15} more` : null,
            "",
            `It starts with "📉 نزل سعره! بقى ${re.shortAr(listing.price)} بدل ${re.shortAr(cut.was)} …". ⏱️ One every ${s.gapMin}–${s.gapMax} s, ${s.from}–${s.to}, at most ${s.perDay} a day: about ${e.minutes} min.`,
            "",
            `Start: ${ctx.prefix}blast ${listing.id} drop go`,
          ]
            .filter((x) => x !== null)
            .join("\n"),
        );
      }
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
