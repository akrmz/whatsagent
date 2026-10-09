"use strict";

const viewings = require("../../services/viewings");
const booking = require("../../services/selfbooking");
const leads = require("../../services/leads");
const re = require("../../services/realestate");
const { parseWhen } = require("../../services/reminders");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = [
  {
    name: "viewing",
    clientData: true,
    aliases: ["moaayna", "visit", "showing"],
    category: "realestate",
    description:
      "مواعيد المعاينة — book a viewing: a client, a listing and a time. You get a reminder an hour before (in this chat); add \"send\" to also send the client a confirmation on WhatsApp. The client moves to the viewing stage. Two hours after, you are asked how it went: \"done\" records it (liked moves the client to negotiating). \"hours\", \"days\" and \"length\" set when clients may book themselves (.agent booking on: they send معاينة and pick a free time); \"slots\" shows the next free times. Owner and sudo users.",
    usage: "add <client> <listing> <when> [send] | done <id> liked|thinking|no [note] | del <id> | hours 11:00-19:00 | days sat-thu | length 60 | slots",
    examples: [".viewing add 5 12 tomorrow at 4pm", ".viewing add 5 12 friday at 18:00 send", ".viewing done 3 liked عايز يتفاوض على السعر", ".viewing del 3", ".viewing hours 11:00-19:00", ".viewing days sat-thu", ".viewing slots"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const zone = ctx.config.bot.timezone;
      if (sub === "del" || sub === "delete" || sub === "cancel") {
        const v = viewings.remove(ctx.state, idOf(ctx.args[1]));
        return ctx.reply(`🗑️ Viewing #${v.id} cancelled.`);
      }
      if (sub === "done" || sub === "result" || sub === "نتيجة") {
        const id = idOf(ctx.args[1]);
        const result = viewings.resultFrom(ctx.args[2]);
        if (!id || !result) throw new UserError(`Usage: ${ctx.prefix}viewing done <viewing> liked | thinking | no | noshow [note]\n(أعجبه · بيفكر · لم يعجبه · محضرش)`);
        const note = ctx.args.slice(3).join(" ").slice(0, 200);
        const v = viewings.done(ctx.state, id, result, note, ctx.sender);
        const c = leads.get(ctx.state, v.lead);
        const next =
          result === "liked"
            ? `\n🤝 #${v.lead} moved to negotiating. Next: ${ctx.prefix}offer ${v.listing} #${v.lead} … or ${ctx.prefix}lead follow ${v.lead} tomorrow at 10am`
            : result === "thinking"
              ? `\n⏰ A follow-up helps: ${ctx.prefix}lead follow ${v.lead} بعد 3 أيام`
              : result === "noshow"
                ? `\n📅 Book again: ${ctx.prefix}viewing add ${v.lead} ${v.listing} <when> send${(c?.noShows || 0) > 1 ? ` · ⚠️ ${c.noShows} missed viewings so far` : ""}`
                : `\n🔎 Other listings for them: ${ctx.prefix}lead ${v.lead}`;
        return ctx.reply(`📝 Viewing #${id}: ${viewings.RESULTS[result].ar}${note ? ` — ${note}` : ""} (${c ? `${c.name || "عميل"} #${c.id}` : `#${v.lead}`}, #${v.listing})${next}`);
      }
      // Self-booking (.agent booking on): the hours and days clients can pick from.
      if (["hours", "days", "length", "slots", "مواعيد"].includes(sub)) {
        const value = ctx.args.slice(1).join(" ");
        if (sub === "hours" && value) booking.setHours(ctx.state, value);
        if (sub === "days" && value) booking.setDays(ctx.state, value);
        if (sub === "length" && value) booking.setLength(ctx.state, Number(re.latinDigits(value)));
        const free = booking.freeSlots(ctx.state, zone);
        const on = re.agent(ctx.state).booking;
        return ctx.reply(
          [
            `🗓️ *Viewing hours for self-booking*: ${booking.describe(booking.settings(ctx.state))}`,
            `Clients booking themselves: ${on ? "on" : `off — ${ctx.prefix}agent booking on`}`,
            "",
            free.length ? `Next free times:\n${free.map((t) => `▫️ ${viewings.when(t, zone)}`).join("\n")}` : "No free time in the next 7 days.",
            "",
            `Change: ${ctx.prefix}viewing hours 11:00-19:00 · ${ctx.prefix}viewing days sat-thu · ${ctx.prefix}viewing length 60`,
          ].join("\n"),
        );
      }
      if (sub !== "add" && sub !== "new") return ctx.reply(`Usage: ${ctx.prefix}viewing add <client> <listing> tomorrow at 4pm [send] · ${ctx.prefix}viewing done <viewing> liked|thinking|no · ${ctx.prefix}viewings`);
      const [lead, listing] = [idOf(ctx.args[1]), idOf(ctx.args[2])];
      if (!lead || !listing) throw new UserError(`Usage: ${ctx.prefix}viewing add <client number> <listing number> <when>`);
      let rest = ctx.args.slice(3).join(" ");
      // "\b" doesn't work next to Arabic letters, so the word is matched after a space.
      const SEND = /(?:^|\s+)(send|ابعت|أرسل|ارسل)$/i;
      const send = SEND.test(rest);
      rest = rest.replace(SEND, "");
      const w = parseWhen(rest, zone);
      if (!w || w.every) throw new UserError("When? e.g. tomorrow at 4pm, friday at 18:00, at 17:30, 3h");
      const known = leads.get(ctx.state, lead);
      const v = viewings.add(ctx.state, { lead, listing, at: Date.now() + w.ms, chat: ctx.chatId, by: ctx.sender, notifyClient: send && Boolean(known?.phone) });
      const client = leads.get(ctx.state, lead);
      if (["new", "contacted"].includes(client.status)) leads.update(ctx.state, lead, { status: "viewing" });
      leads.note(ctx.state, lead, ctx.sender, `موعد معاينة #${listing}: ${viewings.when(v.at, zone)}`);
      let sent = "";
      if (send) {
        if (!client.phone) sent = "\n⚠️ The client has no number, so no confirmation was sent.";
        else {
          await ctx.sock.sendMessage(`${client.phone}@s.whatsapp.net`, { text: viewings.confirmation(ctx.state, v, zone) });
          sent = `\n📤 Confirmation sent to +${client.phone}.${v.notifyClient && v.at - Date.now() > 3 * 60 * 60 * 1000 ? " They'll also get a reminder 2 hours before (with the location pin if the listing has one)." : ""}`;
        }
      }
      return ctx.reply(`✅ Viewing booked\n${viewings.line(ctx.state, v, zone)}\n⏰ I'll remind you here an hour before.${sent}`);
    },
  },
  {
    name: "viewings",
    clientData: true,
    aliases: ["appointments", "mawaeed"],
    category: "realestate",
    description: "المعاينات القادمة — upcoming viewings, soonest first (today's past ones too, with their outcome), the ones still without an outcome, and \"ics\": a calendar file of the upcoming ones for Google Calendar or your phone. Owner and sudo users.",
    usage: "[ics]",
    examples: [".viewings", ".viewings ics"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const zone = ctx.config.bot.timezone;
      if (/^(ics|calendar|cal|تقويم)$/i.test(ctx.args[0] || "")) {
        const { text, count } = viewings.ics(ctx.state, zone);
        if (!count) return ctx.reply(`No upcoming viewings to export. ${ctx.prefix}viewing add <client> <listing> tomorrow at 4pm`);
        return ctx.reply({ document: Buffer.from(text, "utf8"), mimetype: "text/calendar", fileName: "viewings.ics", caption: `🗓️ ${count} viewing(s) — open the file to add them to your calendar (Google Calendar, iPhone, Outlook), with a reminder an hour before each.` });
      }
      const list = viewings.upcoming(ctx.state);
      const open = viewings.pending(ctx.state).filter((v) => !list.includes(v));
      if (!list.length && !open.length) return ctx.reply(`No viewings booked. ${ctx.prefix}viewing add <client> <listing> tomorrow at 4pm`);
      const result = (v) => (v.outcome ? ` — ${viewings.RESULTS[v.outcome.result].ar}` : v.at < Date.now() ? " — 📝 no outcome yet" : "");
      const lines = [`🗓️ *المعاينات (${list.length})*`, "", ...list.slice(0, 25).map((v) => viewings.line(ctx.state, v, zone) + result(v))];
      if (open.length) lines.push("", `📝 *بدون نتيجة (${open.length})*`, ...open.slice(0, 10).map((v) => viewings.line(ctx.state, v, zone)));
      lines.push("", `${ctx.prefix}viewing done <number> liked|thinking|no · ${ctx.prefix}viewing del <number> · ${ctx.prefix}viewings ics (calendar file)`);
      return ctx.reply(lines.join("\n"));
    },
  },
  {
    name: "commission",
    aliases: ["omola", "brokerage"],
    category: "realestate",
    description: "حساب العمولة — the brokerage commission on a deal: price × rate, optionally with VAT on the commission and your share when it is split with another broker or the office.",
    usage: "<price> <rate %> [vat <%>] [share <your %>]",
    examples: [".commission 3.5m 2.5%", ".commission 3.5m 2.5% vat 14% share 50%"],
    cooldown: 2,
    async run(ctx) {
      const t = re.latinDigits(ctx.text.toLowerCase()).replace(/(\d)\s+(مليون|million|ألف|الف)/g, "$1$2").split(/\s+/).filter(Boolean);
      const price = re.parseAmount(t[0] || "");
      const rate = Number(String(t[1] || "").replace("%", ""));
      if (!price || !(rate > 0 && rate <= 20)) return ctx.reply(`Usage: ${ctx.prefix}commission 3.5m 2.5% [vat 14%] [share 50%]`);
      const pct = (key) => {
        const i = t.findIndex((x) => x === key || x === { vat: "ضريبة", share: "نصيبي" }[key]);
        return i >= 0 ? Number(String(t[i + 1] || "").replace("%", "")) : null;
      };
      const vat = pct("vat");
      const share = pct("share");
      if (vat !== null && !(vat >= 0 && vat <= 30)) throw new UserError("VAT: 0–30%.");
      if (share !== null && !(share > 0 && share <= 100)) throw new UserError("Share: 1–100%.");
      const cur = re.agent(ctx.state).currency;
      const commission = (price * rate) / 100;
      const tax = vat ? (commission * vat) / 100 : 0;
      const mine = share ? (commission * share) / 100 : null;
      return ctx.reply(
        [
          "💼 *العمولة · Commission*",
          `💰 قيمة الصفقة: ${re.money(price, cur)}`,
          `📊 العمولة ${rate}%: *${re.money(commission, cur)}*`,
          vat ? `🧾 ضريبة ${vat}%: ${re.money(tax, cur)} → الإجمالي ${re.money(commission + tax, cur)}` : null,
          mine !== null ? `🤝 نصيبك ${share}%: *${re.money(mine, cur)}*` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  },
];
