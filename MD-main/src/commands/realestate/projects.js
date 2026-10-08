"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const projects = require("../../services/projects");
const { getText } = require("../../core/context");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#?p?/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const textOrQuoted = (ctx, own) => own.trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");

/** "🎯 يناسب: #3 أحمد، #7 منى" (management replies only: client names are private). */
function clientsLine(ctx, p) {
  const m = leads.all(ctx.state).filter((l) => !["won", "lost"].includes(l.status) && projects.suits(p, l));
  return m.length ? `\n\n🎯 يناسب ${m.length} من عملائك: ${m.slice(0, 5).map((l) => `#${l.id} ${l.name || ""}`.trim()).join("، ")}${m.length > 5 ? " …" : ""}` : "";
}

const HELP = (p) =>
  [
    "🏗️ *Projects · المشروعات*",
    `${p}project add (then lines: المشروع، المطور، المنطقة، الوحدات، يبدأ من، المقدم، التقسيط، الاستلام، الصيانة) — add`,
    `${p}project 3 — details and the instalment for the cheapest unit`,
    `${p}project edit 3 المقدم: 5% · ${p}project del 3`,
    `${p}projects [area] [حتى 8 مليون] [مقدم 10%] [8 سنين] [فوري] — search`,
  ].join("\n");

module.exports = [
  {
    name: "project",
    aliases: ["compound", "mashroo"],
    category: "realestate",
    description:
      "مشروعات المطورين — off-plan projects you sell: developer, area, unit types and sizes, starting price, down payment, instalment years, delivery and maintenance; the card works out the instalment for the cheapest unit. Anyone can view; the owner and sudo users manage.",
    usage: "add <lines> | <id> | edit <id> <lines> | del <id>",
    examples: [".project add\nالمشروع: ماونتن فيو آي سيتي\nالمطور: ماونتن فيو\nالمنطقة: التجمع الخامس\nالوحدات: شقق من 120 لـ 200 م، تاون هاوس\nيبدأ من: 6.5 مليون\nالمقدم: 10%\nالتقسيط: 8 سنوات\nالاستلام: 2028", ".project 3", ".project edit 3 المقدم: 5%"],
    cooldown: 2,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const a = re.agent(ctx.state);
      const direct = idOf(sub);
      if (direct) {
        const p = projects.get(ctx.state, direct);
        if (!p) return ctx.reply(`There is no project P${direct}.`);
        return ctx.reply(projects.card(p, a) + (ctx.isSudoOrOwner ? clientsLine(ctx, p) : ""));
      }
      if (!sub) return ctx.reply(HELP(ctx.prefix));
      if (!ctx.isSudoOrOwner) return ctx.reply(`Only the owner and sudo users manage projects. Anyone can view them: ${ctx.prefix}projects · ${ctx.prefix}project <number>`);

      if (sub === "add" || sub === "new") {
        const p = projects.add(ctx.state, projects.parseProjectText(textOrQuoted(ctx, ctx.text.replace(/^\S+\s*/, ""))), ctx.sender);
        const missing = [!p.price && "يبدأ من", p.down === undefined && "المقدم", !p.years && "التقسيط", !p.delivery && "الاستلام"].filter(Boolean);
        return ctx.reply(`✅ Saved as *P${p.id}*\n\n${projects.card(p, a)}${missing.length ? `\n\n⚠️ Missing: ${missing.join("، ")} — ${ctx.prefix}project edit ${p.id} …` : ""}${clientsLine(ctx, p)}`);
      }
      const id = idOf(arg);
      if (!id || !projects.get(ctx.state, id)) throw new UserError(id ? `There is no project P${id}.` : HELP(ctx.prefix));
      if (sub === "edit") {
        const changes = projects.parseProjectText(textOrQuoted(ctx, ctx.text.replace(/^\S+\s+\S+\s*/, "")));
        if (!Object.keys(changes).length) throw new UserError(`Write the fields to change, e.g. ${ctx.prefix}project edit ${id} المقدم: 5%`);
        const p = projects.update(ctx.state, id, changes);
        return ctx.reply(`✏️ Updated P${id}: ${Object.keys(changes).join(", ")}\n\n${projects.card(p, a)}`);
      }
      if (sub === "del" || sub === "delete" || sub === "remove") {
        const p = projects.remove(ctx.state, id);
        return ctx.reply(`🗑️ Deleted P${p.id} (${p.name}).`);
      }
      return ctx.reply(HELP(ctx.prefix));
    },
  },
  {
    name: "projects",
    aliases: ["compounds", "mashareea"],
    category: "realestate",
    description:
      "البحث في مشروعات المطورين — searches the projects, cheapest first: words from the name, developer or area, a unit type (شقة، فيلا، تاون هاوس …), \"حتى 8 مليون\" (starting price), \"مقدم 10%\" (at most), \"8 سنين\" (at least), \"فوري\" (ready to move in).",
    usage: "[filters]",
    examples: [".projects", ".projects التجمع", ".projects حتى 8 مليون مقدم 10% 8 سنين", ".projects فيلا زايد فوري"],
    cooldown: 3,
    async run(ctx) {
      const { list } = projects.search(ctx.state, ctx.text);
      const cur = re.agent(ctx.state).currency;
      if (!list.length) return ctx.reply(projects.all(ctx.state).length ? "No project matches. Try fewer filters." : `No projects yet. Add one: ${ctx.prefix}project add`);
      const shown = list.slice(0, 15);
      return ctx.reply(`🏗️ *${list.length} مشروع*${list.length > shown.length ? ` (أول ${shown.length})` : ""}\n\n${shown.map((p) => projects.line(p, cur)).join("\n")}\n\n${ctx.prefix}project <number> للتفاصيل وحساب القسط`);
    },
  },
];
