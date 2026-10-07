"use strict";

const fs = require("node:fs");
const leads = require("../../services/leads");
const re = require("../../services/realestate");
const { parseWhen } = require("../../services/reminders");
const { getText } = require("../../core/context");
const { UserError } = require("../../core/errors");

const base = { category: "realestate", permission: "sudo", cooldown: 2 };
const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const opts = (ctx) => ({ currency: re.agent(ctx.state).currency, timeZone: ctx.config.bot.timezone });
const owner = (ctx) => ctx.config.owners.numbers[0];

const HELP = (p) =>
  [
    "👥 *Clients · العملاء*",
    `${p}lead add (details, or reply to a contact card) — save a client`,
    `${p}lead 5 — card, history and matching listings`,
    `${p}lead note 5 <text> · ${p}lead status 5 viewing`,
    `${p}lead follow 5 tomorrow at 10am <note> — follow-up reminder`,
    `${p}lead send 5 12 — send listing #12 to the client on WhatsApp`,
    `${p}lead edit 5 الميزانية: 3-4 مليون · ${p}lead del 5`,
    `${p}lead assign 5 @colleague | me | none — for teams · ${p}leads mine`,
    `${p}leads [status | words] — the list`,
    "",
    `Statuses: ${Object.entries(leads.STATUS).map(([k, s]) => `${k} (${s.ar})`).join(", ")}`,
  ].join("\n");

module.exports = [
  {
    ...base,
    name: "lead",
    aliases: ["client", "customer", "ameel"],
    description:
      "متابعة العملاء — a client tracker: save a client (labelled lines, or reply to a shared contact card), their budget and what they want; notes, pipeline status, follow-up reminders, the listings that match, and sending a listing to them on WhatsApp. Owner and sudo users.",
    usage: "add <details> | <id> | note <id> <text> | status <id> <status> | follow <id> <when> [note] | send <id> <listing> | assign <id> @member|me|none | edit <id> <details> | del <id>",
    examples: [".lead add\nالاسم: أحمد\nالموبايل: 01001234567\nالميزانية: 2-3 مليون\nالنوع: شقة\nالمنطقة: التجمع", ".lead 5", ".lead follow 5 tomorrow at 10am يرد على العرض", ".lead send 5 12"],
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const direct = idOf(sub);
      if (direct) {
        const l = leads.get(ctx.state, direct);
        if (!l) return ctx.reply(`There is no client #${direct}.`);
        return ctx.reply(leads.card(l, { ...opts(ctx), matches: leads.matchingListings(ctx.state, l) }));
      }
      if (!sub) return ctx.reply(HELP(ctx.prefix));

      if (sub === "add" || sub === "new") {
        const typed = ctx.text.slice(ctx.args[0].length).trim();
        const quoted = ctx.quoted?.message;
        const fields = leads.parseLeadText(typed || (quoted && !quoted.contactMessage ? getText(quoted) : ""), owner(ctx));
        if (quoted?.contactMessage?.vcard) {
          const c = leads.fromVcard(quoted.contactMessage.vcard);
          fields.name ||= c.name;
          fields.phone ||= leads.normalizePhone(c.phone, owner(ctx)) || undefined;
        }
        const l = leads.add(ctx.state, fields, ctx.sender);
        const matches = leads.matchingListings(ctx.state, l);
        return ctx.reply(`✅ Client saved as *#${l.id}*\n\n${leads.card(l, { ...opts(ctx), matches })}`);
      }

      const id = idOf(ctx.args[1]);
      if (!id) return ctx.reply(HELP(ctx.prefix));
      const lead = leads.get(ctx.state, id);
      if (!lead) return ctx.reply(`There is no client #${id}.`);
      const rest = ctx.text.replace(/^\S+\s+\S+\s*/, "");

      if (sub === "note") {
        leads.note(ctx.state, id, ctx.sender, rest);
        return ctx.reply(`📝 Note added to #${id}.`);
      }
      if (sub === "status") {
        const status = leads.statusFrom(ctx.args[2]);
        if (!status) throw new UserError(`Status: ${Object.keys(leads.STATUS).join(", ")}`);
        leads.update(ctx.state, id, { status });
        leads.note(ctx.state, id, ctx.sender, `الحالة: ${leads.STATUS[status].ar}`);
        return ctx.reply(`🔖 #${id} ${lead.name || ""}: ${leads.STATUS[status].ar}`);
      }
      if (sub === "follow" || sub === "followup" || sub === "remind") {
        if (/^(off|cancel|الغاء|إلغاء)$/i.test(rest)) {
          leads.update(ctx.state, id, { followUp: null });
          return ctx.reply(`⏰ Follow-up for #${id} cancelled.`);
        }
        const w = parseWhen(rest, ctx.config.bot.timezone);
        if (!w || w.every) throw new UserError(`When? e.g. ${ctx.prefix}lead follow ${id} tomorrow at 10am, ${ctx.prefix}lead follow ${id} 2h, ${ctx.prefix}lead follow ${id} friday at 18:00`);
        const at = Date.now() + w.ms;
        leads.setFollowUp(ctx.state, id, { at, chat: ctx.chatId, by: ctx.sender, note: w.rest });
        const t = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.config.bot.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
        return ctx.reply(`⏰ I'll remind you here to follow up with #${id} ${lead.name || ""} on ${t}.`);
      }
      if (sub === "send") {
        const listing = re.get(ctx.state, idOf(ctx.args[2]));
        if (!listing) throw new UserError(`Which listing? ${ctx.prefix}lead send ${id} <listing number>`);
        if (!lead.phone) throw new UserError(`Client #${id} has no phone number. Add one: ${ctx.prefix}lead edit ${id} الموبايل: 01001234567`);
        if (lead.optedOut) throw new UserError(`Client #${id} asked not to receive offers (وقف). If they ask for them again, they can send اشتراك.`);
        const jid = `${lead.phone}@s.whatsapp.net`;
        const [found] = (await ctx.sock.onWhatsApp?.(jid).catch(() => null)) || [];
        if (found && !found.exists) throw new UserError(`+${lead.phone} is not on WhatsApp.`);
        const a = re.agent(ctx.state);
        const [photo] = re.photos(ctx.config, listing);
        const greeting = lead.name ? `أهلاً ${lead.name} 👋\n\n` : "";
        if (photo) await ctx.sock.sendMessage(jid, { image: fs.readFileSync(photo), caption: greeting + re.card(listing, a) });
        else await ctx.sock.sendMessage(jid, { text: greeting + re.card(listing, a) });
        leads.markSent(ctx.state, id, listing.id, ctx.sender, `أُرسل له العقار #${listing.id}`);
        return ctx.reply(`📤 Listing #${listing.id} sent to #${id} ${lead.name || ""} (+${lead.phone}).`);
      }
      if (sub === "edit") {
        const changes = leads.parseLeadText(rest, owner(ctx));
        const { notes, ...fields } = changes;
        if (!Object.keys(fields).length && !notes) throw new UserError(`Write what to change, e.g. ${ctx.prefix}lead edit ${id} الميزانية: 3-4 مليون`);
        if (Object.keys(fields).length) leads.update(ctx.state, id, fields);
        if (notes) leads.note(ctx.state, id, ctx.sender, notes);
        return ctx.reply(`✏️ Updated #${id}.\n\n${leads.card(leads.get(ctx.state, id), { ...opts(ctx), matches: leads.matchingListings(ctx.state, leads.get(ctx.state, id)) })}`);
      }
      if (sub === "assign") {
        const who = (ctx.args[2] || "").toLowerCase();
        if (["none", "off", "-"].includes(who)) {
          leads.update(ctx.state, id, { assignee: null });
          return ctx.reply(`🧑‍💼 #${id} is no longer assigned.`);
        }
        const target = who === "me" || who === "أنا" ? ctx.sender : ctx.mentions[0];
        if (!target) throw new UserError(`Mention the team member (${ctx.prefix}lead assign ${id} @name), or "me", or "none".`);
        if (!ctx.app.permissions.isSudo(target) && !ctx.app.permissions.isOwner(target)) throw new UserError("Assign clients to the owner or a sudo user (.sudo add).");
        const jid = ctx.app.identity.toPn(target) || target;
        leads.update(ctx.state, id, { assignee: jid });
        leads.note(ctx.state, id, ctx.sender, `أُسند إلى @${jid.split("@")[0]}`);
        return ctx.reply({ text: `🧑‍💼 Client #${id} ${lead.name || ""} assigned to @${jid.split("@")[0]}.`, mentions: [jid] });
      }
      if (sub === "del" || sub === "delete" || sub === "remove") {
        const l = leads.remove(ctx.state, id);
        return ctx.reply(`🗑️ Client #${l.id} ${l.name || ""} deleted.`);
      }
      return ctx.reply(HELP(ctx.prefix));
    },
  },
  {
    ...base,
    name: "leads",
    aliases: ["clients", "customers", "pipeline"],
    description: "قائمة العملاء — your clients: the pipeline (how many in each stage) and the latest ones; filter by a status (new, viewing …), \"mine\" (assigned to you), or search by name, number, area or notes. Owner and sudo users.",
    usage: "[status | words]",
    examples: [".leads", ".leads viewing", ".leads mine", ".leads التجمع", ".leads 0100"],
    async run(ctx) {
      const list = leads.search(ctx.state, ctx.text, { me: ctx.app.identity.aliases(ctx.sender) });
      const everyone = leads.all(ctx.state);
      if (!everyone.length) return ctx.reply(`No clients yet. Add one: ${ctx.prefix}lead add`);
      const counts = Object.entries(leads.STATUS)
        .map(([k, s]) => [s.ar, everyone.filter((l) => l.status === k).length])
        .filter(([, n]) => n)
        .map(([ar, n]) => `${ar}: ${n}`)
        .join(" · ");
      const due = everyone.filter((l) => l.followUp).sort((a, b) => a.followUp.at - b.followUp.at);
      const cur = re.agent(ctx.state).currency;
      const shown = list.slice(0, 20);
      return ctx.reply(
        [
          `👥 *العملاء (${everyone.length})*`,
          counts,
          due.length ? `⏰ متابعات قادمة: ${due.slice(0, 5).map((l) => `#${l.id}`).join("، ")}` : null,
          "",
          ctx.text ? `*${list.length} نتيجة:*` : "*الأحدث:*",
          ...(shown.length ? shown.map((l) => leads.line(l, cur)) : ["—"]),
          "",
          `${ctx.prefix}lead <number> للتفاصيل`,
        ]
          .filter((l) => l !== null)
          .join("\n"),
      );
    },
  },
];
