"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const csv = require("../../services/csv");
const metaleads = require("../../services/metaleads");
const digest = require("../../services/digest");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;

// Columns written by .export, renamed to labels the text readers understand.
const LISTING_COLUMNS = { size_m2: "size", baths: "baths" };
const LEAD_COLUMNS = { last_note: "notes" };
const IGNORE = new Set(["id", "photos", "price_per_m2", "created", "updated", "follow_up", "status", "budget_min", "budget_max"]);

/** One CSV row as "label: value" lines, for the same readers as typed listings/clients. */
const rowText = (row, rename) =>
  Object.entries(row)
    .filter(([k, v]) => v && !IGNORE.has(k))
    // "'=…" is how .export keeps formula-like text as text; the apostrophe isn't part of it.
    .map(([k, v]) => `${rename[k] || k.replace(/_/g, " ")}: ${String(v).replace(/^'(?=[=+\-@])/, "").replace(/\s*\n\s*/g, " ")}`)
    .join("\n");

const STATUS_OF = { available: "available", reserved: "reserved", sold: "sold", rented: "rented", "متاح": "available", "محجوز": "reserved", "مباع": "sold", "مؤجر": "rented" };

/**
 * Adds the rows of a CSV file as listings or clients.
 * @returns {{ added: number, total: number, truncated: boolean, skipped: string[] }} skipped: "row: reason"
 */
function importCsv(state, text, kind, { by, ownerNumber }) {
  const { header, rows } = csv.records(text, { maxRows: MAX_IMPORT_ROWS });
  if (!rows.length) throw new UserError("The file has no rows under the header.");
  const meta = kind === "leads" && metaleads.isMeta(header); // a Facebook/Instagram lead-ads export
  const ids = [];
  let added = 0;
  const skipped = [];
  rows.slice(0, MAX_IMPORT_ROWS).forEach((row, i) => {
    const n = row.line ?? i + 2; // the row number as shown in the spreadsheet
    try {
      if (kind === "listings") {
        const fields = re.parseListingText(rowText(row, LISTING_COLUMNS), ownerNumber);
        const dup = re.findDuplicate(state, fields);
        if (dup) {
          skipped.push(`${n}: same as #${dup.id}`);
          return;
        }
        const l = re.add(state, fields, by);
        const status = STATUS_OF[String(row.status || row["الحالة"] || "").toLowerCase()];
        if (status && status !== "available") re.update(state, l.id, { status });
      } else {
        const fields = meta ? metaleads.fromMeta(row, ownerNumber) : leads.parseLeadText(rowText(row, LEAD_COLUMNS), ownerNumber);
        if (!meta && Number(row.budget_min)) fields.min = Number(row.budget_min);
        if (!meta && Number(row.budget_max)) fields.max = Number(row.budget_max);
        const l = leads.add(state, fields, by);
        ids.push(l.id);
        const status = leads.statusFrom(row.status || row["الحالة"]);
        if (status) leads.update(state, l.id, { status });
      }
      added++;
    } catch (err) {
      skipped.push(`${n}: ${err instanceof UserError ? err.message.split("\n")[0] : "unreadable"}`);
    }
  });
  return { added, total: Math.min(rows.length, MAX_IMPORT_ROWS), truncated: rows.length > MAX_IMPORT_ROWS, skipped, meta, ids };
}

module.exports = [
  {
    name: "import",
    aliases: ["importcsv"],
    category: "realestate",
    description:
      "استيراد من Excel — reply to a CSV file (an Excel sheet saved as CSV, or a file from .export) to add listings or clients in one go. Column headers in English (type, location, price …) or Arabic (النوع، المنطقة، السعر …). Also reads Facebook/Instagram lead-ads downloads as they are (UTF-16, tab-separated): each lead gets its platform as the source, the ad's name, and the form's answers (budget, area, unit type). Duplicates are skipped. Owner and sudo users.",
    usage: "listings | leads (reply to a .csv file)",
    examples: ["(reply to listings.csv) .import listings", "(reply to clients.csv) .import leads"],
    permission: "sudo",
    cooldown: 10,
    async run(ctx) {
      const what = (ctx.args[0] || "").toLowerCase();
      const forListings = ["listings", "listing", "عقارات"].includes(what);
      const forLeads = ["leads", "lead", "clients", "عملاء"].includes(what);
      const media = ctx.findMedia({ types: ["document"] });
      if (!(forListings || forLeads) || !media) {
        return ctx.reply(`Reply to a CSV file with ${ctx.prefix}import listings or ${ctx.prefix}import leads.\nExcel: File → Save As → "CSV UTF-8". Headers can be English (type, deal, location, price, size, rooms …) or Arabic (النوع، الغرض، المنطقة، السعر، المساحة، الغرف …).`);
      }
      if (!/csv|text|excel|octet/.test(media.mimetype || "") && !/\.csv$/i.test(media.content?.fileName || "")) {
        throw new UserError("That isn't a CSV file. In Excel use File → Save As → CSV UTF-8 (.xlsx can't be read).");
      }
      const text = csv.decode(await ctx.download(media, MAX_IMPORT_BYTES));
      await ctx.react("📥");
      const r = importCsv(ctx.state, text, forListings ? "listings" : "leads", { by: ctx.sender, ownerNumber: ctx.config.owners.numbers[0] });
      const more = r.truncated ? `\n(only the first ${MAX_IMPORT_ROWS} rows were read)` : "";
      const withMatches = r.ids.filter((id) => leads.matchingListings(ctx.state, leads.get(ctx.state, id)).length).length;
      const from = r.meta ? " from Facebook/Instagram lead ads" : "";
      const next = forLeads && r.added ? `\n🎯 ${withMatches} of them already have matching listings — ${ctx.prefix}leads hot\n👋 Welcome them all, paced: ${ctx.prefix}leads welcome` : "";
      return ctx.reply(
        `📥 Imported *${r.added}* ${forListings ? "listing(s)" : "client(s)"}${from} of ${r.total}.${more}${next}${r.skipped.length ? `\n\nSkipped ${r.skipped.length}:\n${r.skipped.slice(0, 15).join("\n")}${r.skipped.length > 15 ? "\n…" : ""}` : ""}`,
      );
    },
  },
  {
    name: "digest",
    aliases: ["summary-day", "dailybrief", "molakhas"],
    category: "realestate",
    description: "ملخص اليوم — a morning summary in this chat at the time you choose: today's viewings and follow-ups, new clients, who replied to what you sent and who went quiet after it, clients without contact for a week, rent due and late, contracts ending soon, and the catalogue. Owner and sudo users.",
    usage: "on <time> | off | now | (no argument: status)",
    examples: [".digest on 08:30", ".digest now", ".digest off"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const e = digest.get(ctx.state, ctx.chatId);
      if (sub === "now") return ctx.reply(digest.build(ctx.state, ctx.config.bot.timezone));
      if (sub === "off") {
        digest.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ Daily summary turned off.");
      }
      if (sub === "on") {
        const minutes = parseClock(ctx.args[1] || "");
        if (minutes === null) throw new UserError(`Give the time, e.g. ${ctx.prefix}digest on 08:30`);
        const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        digest.set(ctx.state, ctx.chatId, time);
        return ctx.reply(`✅ A summary here every day at ${time}. ${ctx.prefix}digest now to see it.`);
      }
      return ctx.reply(e ? `📋 Daily summary: *on* at ${e.time}\n${ctx.prefix}digest now · ${ctx.prefix}digest off` : `📋 Daily summary: *off*\n${ctx.prefix}digest on 08:30`);
    },
  },
];

module.exports.importCsv = importCsv;
