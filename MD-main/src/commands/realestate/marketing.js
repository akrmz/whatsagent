"use strict";

const re = require("../../services/realestate");
const places = require("../../services/places");
const leads = require("../../services/leads");
const img = require("../../services/reimages");
const pdf = require("../../services/pdf");
const autolistings = require("../../services/autolistings");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

const MAX_BROCHURE = 20;

/** A CSV cell: quoted when needed, so commas, quotes and line breaks in notes stay in their column. */
const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// The byte-order mark makes Excel open the file as UTF-8 (Arabic shows correctly).
const BOM = String.fromCharCode(0xfeff);
const csv = (rows) => Buffer.from(`${BOM}${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`, "utf8");
const date = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");

module.exports = [
  {
    name: "autolistings",
    aliases: ["listingofday", "dailylisting"],
    category: "realestate",
    description:
      "عقار اليوم — posts one available listing a day in this chat at the time you choose, as a flyer with its details, going round your catalogue. Add a search to post only some (e.g. شقة التجمع). Owner and sudo users.",
    usage: "on <time> [search] | off | now | (no argument: status)",
    examples: [".autolistings on 10:00", ".autolistings on 19:00 شقة التجمع", ".autolistings now", ".autolistings off"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const e = autolistings.get(ctx.state, ctx.chatId);
      if (!sub || sub === "status") {
        if (!e) return ctx.reply(`🏡 Listing of the day: *off*\n${ctx.prefix}autolistings on 10:00 [search]`);
        const n = autolistings.next(ctx.state, e);
        return ctx.reply(`🏡 Listing of the day: *on*, every day at ${e.time}${e.query ? ` — only "${e.query}"` : ""}\nNext: ${n ? `#${n.id}` : "nothing available"}`);
      }
      if (sub === "off") {
        autolistings.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ Listing of the day turned off.");
      }
      if (sub === "now") {
        const n = autolistings.next(ctx.state, e || { query: ctx.args.slice(1).join(" ") });
        if (!n) return ctx.reply("No available listing to post.");
        await autolistings.post(ctx.app, ctx.chatId, n);
        if (e) autolistings.markPosted(ctx.state, ctx.chatId, n.id); // the daily post continues after this one
        return undefined;
      }
      if (sub !== "on") return ctx.reply(`Usage: ${ctx.prefix}autolistings on 10:00 [search] | off | now`);
      const minutes = parseClock(ctx.args[1] || "");
      if (minutes === null) throw new UserError(`Give the time, e.g. ${ctx.prefix}autolistings on 10:00`);
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      const query = ctx.args.slice(2).join(" ");
      try {
        autolistings.set(ctx.state, ctx.chatId, { time, query });
      } catch {
        throw new UserError("Too many chats get a listing of the day already.");
      }
      const n = autolistings.next(ctx.state, autolistings.get(ctx.state, ctx.chatId));
      return ctx.reply(`✅ A listing every day at ${time}${query ? ` (only "${query}")` : ""}. First: ${n ? `#${n.id}` : "none available yet"}.\n${ctx.prefix}autolistings now to post one right away.`);
    },
  },
  {
    name: "brochure",
    aliases: ["catalog", "catalogue", "katalog"],
    category: "realestate",
    description: `كتالوج PDF — a PDF with one flyer page per available listing (up to ${MAX_BROCHURE}), optionally only those matching a search, ready to send to a client.`,
    usage: "[search]",
    examples: [".brochure", ".brochure شقة التجمع 2m-4m", ".brochure ايجار"],
    cooldown: 20,
    async run(ctx) {
      const { list } = re.search(ctx.state, ctx.text);
      if (!list.length) return ctx.reply(re.all(ctx.state).length ? "No available listing matches." : `The catalogue is empty. Add one: ${ctx.prefix}listing add`);
      await ctx.react("📄");
      const agent = re.agent(ctx.state);
      const pages = [];
      for (const l of list.slice(0, MAX_BROCHURE)) {
        const [photo] = re.photos(ctx.config, l);
        pages.push({ data: await img.flyer(l, agent, photo), width: 1080, height: 1350 });
      }
      const doc = pdf.build(pages);
      const name = `${(agent.company || agent.name || "listings").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}-${date(Date.now())}.pdf`;
      return ctx.reply({ document: doc, mimetype: "application/pdf", fileName: name, caption: `📄 ${pages.length} عقار${list.length > pages.length ? ` (أول ${pages.length} من ${list.length})` : ""}` });
    },
  },
  {
    name: "export",
    aliases: ["csv", "excel"],
    category: "realestate",
    description: "تصدير إلى Excel — your listings or clients as a CSV file that opens in Excel or Google Sheets (Arabic included). Owner and sudo users.",
    usage: "listings | leads",
    examples: [".export listings", ".export leads"],
    permission: "sudo",
    cooldown: 10,
    async run(ctx) {
      const what = (ctx.args[0] || "").toLowerCase();
      const today = date(Date.now());
      if (["listings", "listing", "units", "عقارات"].includes(what)) {
        const rows = [["id", "type", "deal", "location", "price", "size_m2", "price_per_m2", "rooms", "baths", "floor", "finishing", "status", "photos", "notes", "map", "owner", "created", "updated"]];
        for (const l of re.all(ctx.state).sort((a, b) => a.id - b.id)) {
          rows.push([l.id, l.type, l.deal, l.location, l.price, l.size, l.price && l.size ? Math.round(l.price / l.size) : "", l.rooms, l.baths, l.floor, l.finishing, l.status, l.photos, l.notes, l.geo ? places.mapsUrl(l.geo) : "", l.owner ? [l.owner.name, l.owner.phone && `+${l.owner.phone}`].filter(Boolean).join(" ") : "", date(l.created), date(l.updated)]);
        }
        return ctx.reply({ document: csv(rows), mimetype: "text/csv", fileName: `listings-${today}.csv`, caption: `📊 ${rows.length - 1} listings` });
      }
      if (["leads", "lead", "clients", "عملاء"].includes(what)) {
        const rows = [["id", "name", "phone", "status", "type", "deal", "location", "rooms", "budget_min", "budget_max", "source", "follow_up", "last_note", "created", "updated"]];
        for (const l of leads.all(ctx.state).sort((a, b) => a.id - b.id)) {
          rows.push([l.id, l.name, l.phone ? `+${l.phone}` : "", l.status, l.type, l.deal, l.location, l.rooms, l.min, l.max, l.source, l.followUp ? new Date(l.followUp.at).toISOString() : "", l.history?.at(-1)?.text, date(l.created), date(l.updated)]);
        }
        return ctx.reply({ document: csv(rows), mimetype: "text/csv", fileName: `clients-${today}.csv`, caption: `📊 ${rows.length - 1} clients` });
      }
      return ctx.reply(`Usage: ${ctx.prefix}export listings | ${ctx.prefix}export leads`);
    },
  },
];
