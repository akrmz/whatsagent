"use strict";

const instances = require("../../services/instances");
const { UserError } = require("../../core/errors");

/** A number from the list ("2") or written out ("201198765432", "0119…"). */
function pick(ctx, token) {
  const all = instances.list(ctx.state);
  const t = String(token || "").trim();
  if (/^\d{1,2}$/.test(t) && all[Number(t) - 1]) return all[Number(t) - 1].number;
  const n = instances.numberFrom(ctx.app, t);
  if (!instances.get(ctx.state, n)) throw new UserError(`+${n} isn't one of the numbers (${ctx.prefix}numbers).`);
  return n;
}

module.exports = {
  name: "numbers",
  aliases: ["sessions", "arqam"],
  category: "owner",
  description:
    "More WhatsApp numbers, each its own bot: “add 2011…” runs this bot on another number too, with its own listings, clients and settings, and sends you its pairing code here; “code 2” a new code if it wasn't linked in time; “stop 2”, “start 2”, “restart 2”; “remove 2 confirm” stops it and moves its folder aside (nothing is deleted). Each extra number is managed from your chat with it, like this one. Owner only, in your private chat with the main bot.",
  usage: "[add <number> | code <n> | stop <n> | start <n> | restart <n> | remove <n> confirm]",
  examples: [".numbers", ".numbers add 201198765432", ".numbers code 1", ".numbers stop 1", ".numbers remove 1 confirm"],
  permission: "owner",
  privateOnly: true,
  cooldown: 3,
  async run(ctx) {
    const p = ctx.prefix;
    if (instances.isExtra()) return ctx.reply(`This is an extra number run by your main bot. Manage numbers from your chat with the main bot: ${p}numbers`);
    const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());

    if (sub === "add") {
      await ctx.reply("⏳ Starting the new number and asking WhatsApp for its pairing code (up to a minute and a half)…");
      const { number, code } = await instances.add(ctx.app, ctx.args.slice(1).join(" "), ctx.sender);
      if (!code) return ctx.reply(`+${number} is added and starting, but no pairing code came yet. Check the server's log, then: ${p}numbers code ${number}`);
      return ctx.reply(`${instances.pairingText(number, code)}\n\nOnce linked, it works as a bot of its own; you'll get a message here.`);
    }
    if (sub === "code" || sub === "pair") {
      const number = pick(ctx, arg);
      if (instances.status(ctx.app, number).startsWith("✅")) throw new UserError(`+${number} is already linked and connected.`);
      instances.setEnabled(ctx.app, number, true);
      await instances.restart(ctx.app, number);
      const code = await instances.nextCode(number);
      return ctx.reply(code ? instances.pairingText(number, code) : `No pairing code came for +${number}. Check the server's log and try again in a few minutes.`);
    }
    if (sub === "stop") {
      const number = pick(ctx, arg);
      instances.setEnabled(ctx.app, number, false);
      instances.stop(number);
      return ctx.reply(`⏸️ +${number} stopped. It stays stopped after a restart, until: ${p}numbers start ${number}`);
    }
    if (sub === "start" || sub === "restart") {
      const number = pick(ctx, arg);
      instances.setEnabled(ctx.app, number, true);
      await instances.restart(ctx.app, number);
      return ctx.reply(`▶️ +${number} ${sub === "start" ? "started" : "restarted"}.`);
    }
    if (sub === "remove" || sub === "delete" || sub === "del") {
      const number = pick(ctx, arg);
      if (String(ctx.args[2] || "").toLowerCase() !== "confirm") {
        return ctx.reply(`This stops +${number} and moves its listings, clients, settings and session aside (nothing is deleted; you can delete the folder later on the server).\nTo go ahead: ${p}numbers remove ${number} confirm`);
      }
      const aside = instances.remove(ctx.app, number);
      return ctx.reply(`🗑️ +${number} removed.${aside ? ` Its folder was moved aside on the server: instances/${aside.split(/[\\/]/).pop()}` : ""}\nTo log it out of WhatsApp too: on that phone, WhatsApp → Linked devices → remove the bot.`);
    }
    if (sub && sub !== "list") throw new UserError(`Usage: ${p}numbers · ${p}numbers add 2011… · ${p}numbers code 1 · ${p}numbers stop 1 · ${p}numbers remove 1 confirm`);

    const all = instances.list(ctx.state);
    if (!all.length) {
      return ctx.reply(
        `📱 Only this number runs the bot.\nTo run it on another number too (its own listings, clients and settings): ${p}numbers add 201198765432\nAt most ${instances.MAX_NUMBERS} extra numbers. Each one is its own WhatsApp account, with its own risk of being limited.`,
      );
    }
    return ctx.reply(
      [`📱 *Extra numbers* (${all.length} of ${instances.MAX_NUMBERS})`, "", ...all.map((i, n) => `${n + 1}. +${i.number} — ${instances.status(ctx.app, i.number)}`), "", `${p}numbers code 1 · stop 1 · start 1 · restart 1 · remove 1 confirm`].join("\n"),
    );
  },
};
