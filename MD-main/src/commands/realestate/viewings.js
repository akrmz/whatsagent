"use strict";

const viewings = require("../../services/viewings");
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
    aliases: ["moaayna", "visit", "showing"],
    category: "realestate",
    description:
      "مواعيد المعاينة — book a viewing: a client, a listing and a time. You get a reminder an hour before (in this chat); add \"send\" to also send the client a confirmation on WhatsApp. The client moves to the viewing stage. Owner and sudo users.",
    usage: "add <client> <listing> <when> [send] | del <id>",
    examples: [".viewing add 5 12 tomorrow at 4pm", ".viewing add 5 12 friday at 18:00 send", ".viewing del 3"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const zone = ctx.config.bot.timezone;
      if (sub === "del" || sub === "delete" || sub === "cancel") {
        const v = viewings.remove(ctx.state, idOf(ctx.args[1]));
        return ctx.reply(`🗑️ Viewing #${v.id} cancelled.`);
      }
      if (sub !== "add" && sub !== "new") return ctx.reply(`Usage: ${ctx.prefix}viewing add <client> <listing> tomorrow at 4pm [send] · ${ctx.prefix}viewings`);
      const [lead, listing] = [idOf(ctx.args[1]), idOf(ctx.args[2])];
      if (!lead || !listing) throw new UserError(`Usage: ${ctx.prefix}viewing add <client number> <listing number> <when>`);
      let rest = ctx.args.slice(3).join(" ");
      // "\b" doesn't work next to Arabic letters, so the word is matched after a space.
      const SEND = /(?:^|\s+)(send|ابعت|أرسل|ارسل)$/i;
      const send = SEND.test(rest);
      rest = rest.replace(SEND, "");
      const w = parseWhen(rest, zone);
      if (!w || w.every) throw new UserError("When? e.g. tomorrow at 4pm, friday at 18:00, at 17:30, 3h");
      const v = viewings.add(ctx.state, { lead, listing, at: Date.now() + w.ms, chat: ctx.chatId, by: ctx.sender });
      const client = leads.get(ctx.state, lead);
      if (["new", "contacted"].includes(client.status)) leads.update(ctx.state, lead, { status: "viewing" });
      leads.note(ctx.state, lead, ctx.sender, `موعد معاينة #${listing}: ${viewings.when(v.at, zone)}`);
      let sent = "";
      if (send) {
        if (!client.phone) sent = "\n⚠️ The client has no number, so no confirmation was sent.";
        else {
          await ctx.sock.sendMessage(`${client.phone}@s.whatsapp.net`, { text: viewings.confirmation(ctx.state, v, zone) });
          sent = `\n📤 Confirmation sent to +${client.phone}.`;
        }
      }
      return ctx.reply(`✅ Viewing booked\n${viewings.line(ctx.state, v, zone)}\n⏰ I'll remind you here an hour before.${sent}`);
    },
  },
  {
    name: "viewings",
    aliases: ["appointments", "mawaeed"],
    category: "realestate",
    description: "المعاينات القادمة — upcoming viewings, soonest first (today's past ones too). Owner and sudo users.",
    examples: [".viewings"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const list = viewings.upcoming(ctx.state);
      if (!list.length) return ctx.reply(`No viewings booked. ${ctx.prefix}viewing add <client> <listing> tomorrow at 4pm`);
      const zone = ctx.config.bot.timezone;
      return ctx.reply(`🗓️ *المعاينات (${list.length})*\n\n${list.slice(0, 25).map((v) => viewings.line(ctx.state, v, zone)).join("\n")}\n\n${ctx.prefix}viewing del <number> to cancel`);
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
