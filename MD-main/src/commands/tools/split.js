"use strict";

const { UserError } = require("../../core/errors");

const num = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/,/g, ""));
const money = (cents) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * ".split 450 3", ".split 450 3 10%" (tip), ".split 1,250.50 4 tip 12".
 * Works in cents so the parts always add up to the total.
 */
function split(text) {
  const t = String(text || "").trim().toLowerCase().replace(/\btip\b/, "").replace(/\s+/g, " ");
  const m = t.match(/^([\d٠-٩][\d٠-٩,]*(?:\.\d{1,2})?)\s+(\d{1,3})(?:\s+(\d{1,3}(?:\.\d+)?)\s*%?)?$/);
  if (!m) throw new UserError("Usage: .split <total> <people> [tip %], e.g. .split 450 3 or .split 450 3 10%");
  const total = Math.round(num(m[1]) * 100);
  const people = Number(m[2]);
  const tipPct = m[3] ? Number(m[3]) : 0;
  if (!total || total > 1e12) throw new UserError("Give a total above 0.");
  if (people < 2 || people > 100) throw new UserError("Split between 2 and 100 people.");
  if (tipPct > 100) throw new UserError("A tip of at most 100%.");
  const tip = Math.round((total * tipPct) / 100);
  const grand = total + tip;
  const base = Math.floor(grand / people);
  const extra = grand - base * people; // this many people pay one cent more
  return { total, tip, tipPct, grand, people, base, extra };
}

module.exports = {
  name: "split",
  aliases: ["bill", "splitbill"],
  category: "tools",
  description: "Splits a bill between people, with an optional tip; the shares always add up to the total exactly.",
  usage: "<total> <people> [tip %]",
  examples: [".split 450 3", ".split 1,250.50 4 10%"],
  cooldown: 2,
  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}split 450 3 · ${ctx.prefix}split 450 3 10%`);
    const r = split(ctx.text);
    const lines = [
      `🧾 *Bill split*`,
      `Total: ${money(r.total)}${r.tip ? ` + ${r.tipPct}% tip (${money(r.tip)}) = *${money(r.grand)}*` : ""}`,
      `People: ${r.people}`,
      "",
      r.extra ? `Each pays *${money(r.base)}*, and ${r.extra} of you pay ${money(r.base + 1)} so it adds up exactly.` : `Each pays *${money(r.base)}*`,
    ];
    return ctx.reply(lines.join("\n"));
  },
  split,
};
