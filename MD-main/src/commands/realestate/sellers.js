"use strict";

const re = require("../../services/realestate");
const sellers = require("../../services/sellers");
const newlisting = require("../../services/newlisting");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

const ago = (t) => {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

module.exports = {
  name: "sellers",
  aliases: ["owneroffers", "mollak", "seller"],
  category: "realestate",
  description:
    "عروض الملاك — owners who wrote that they want to sell or rent out (with .agent sellers on, they are asked for the details and photos, collected here). See one, add it to your catalogue as a listing (the person saved as its private owner, their photos attached), or dismiss it. Owner and sudo users.",
  usage: "[<id> | add <id> [missing details] | del <id>]",
  examples: [".sellers", ".sellers 3", ".sellers add 3", ".sellers add 3 النوع: شقة", ".sellers del 3"],
  permission: "sudo",
  clientData: true,
  cooldown: 2,
  async run(ctx) {
    const p = ctx.prefix;
    const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
    const direct = idOf(sub);
    if (direct) {
      const o = sellers.get(ctx.state, direct);
      if (!o) throw new UserError(`There is no offer #${direct}.`);
      return ctx.reply(
        [
          `🏷️ *Offer #${o.id}* — ${o.name || "—"} (+${o.phone}) · ${o.status === "new" ? "waiting for you" : o.status === "added" ? `added as #${o.listing}` : "dismissed"}`,
          sellers.summary(ctx.state, o),
          `📸 ${o.photos} photo(s) · ${ago(o.at)} ago`,
          "",
          `What they wrote:\n${o.text || "—"}`,
          "",
          o.status === "new" ? `Add to the catalogue: ${p}sellers add ${o.id} (add missing details after it) · dismiss: ${p}sellers del ${o.id}\nCall them: https://wa.me/${o.phone}` : null,
        ]
          .filter((x) => x !== null)
          .join("\n"),
      );
    }
    if (sub === "add") {
      const id = idOf(arg);
      if (!id) throw new UserError(`Which offer? ${p}sellers add 3`);
      const extra = ctx.text.replace(/^\s*\S+\s+\S+\s*/, ""); // what follows "add 3", lines kept
      const l = sellers.toListing(ctx.state, ctx.config, id, extra, ctx.sender);
      // As any new listing: the price check, the clients it suits, and with autoblast on the campaign.
      const more = newlisting.afterAdd(ctx, l, { by: ctx.sender, chat: ctx.chatId, showNames: await ctx.isStaffOnlyChat() });
      return ctx.reply(`✅ Offer #${id} is now listing *#${l.id}*${l.photos ? ` with ${l.photos} photo(s)` : ""}; its owner is saved (private).\n\n${re.card(l, re.agent(ctx.state))}${more}\n\nCheck and complete it: ${p}listing edit ${l.id} …`);
    }
    if (sub === "del" || sub === "delete" || sub === "dismiss") {
      const o = sellers.dismiss(ctx.state, ctx.config, idOf(arg));
      return ctx.reply(`🗑️ Offer #${o.id} dismissed${o.photos ? " (its photos deleted)" : ""}.`);
    }
    sellers.expire(ctx.state, ctx.config); // offers untouched for 30 days go, with their photos
    const open = sellers.list(ctx.state, "new");
    const on = re.agent(ctx.state).sellers;
    if (!open.length) return ctx.reply(`No owner offers waiting.${on ? "" : `\nTurn on collecting them: ${p}agent sellers on (owners who write "عايز أبيع شقتي" are asked for the details and photos)`}`);
    return ctx.reply(
      [
        `🏷️ *Owners' offers* (${open.length}) — newest first`,
        "",
        ...open.slice(0, 20).map((o) => `▫️ *#${o.id}* ${o.name || "—"} (+${o.phone}) — ${sellers.summary(ctx.state, o)}${o.photos ? ` · 📸 ${o.photos}` : ""} · ${ago(o.updated)}`),
        "",
        `${p}sellers <id> — details · ${p}sellers add <id> — to the catalogue · ${p}sellers del <id>`,
      ].join("\n"),
    );
  },
};
