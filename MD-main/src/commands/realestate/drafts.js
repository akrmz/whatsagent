"use strict";

const fs = require("node:fs");
const re = require("../../services/realestate");
const drafts = require("../../services/drafts");
const channels = require("../../services/channels");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const owner = (ctx) => ctx.config.owners.numbers[0];
/** Everything after "save 3" (or "save all"), line breaks kept, for the edits. */
const editsAfter = (ctx) => ctx.text.replace(/^\S+\s+\S+\s*/, "");

async function show(ctx, d) {
  const text = drafts.reviewText(ctx.state, d, { p: ctx.prefix, ownerNumber: owner(ctx) });
  const pics = drafts.photos(ctx.config, d);
  if (!pics.length) return ctx.reply(text);
  for (const [i, p] of pics.entries()) await ctx.reply({ image: fs.readFileSync(p), caption: i === 0 ? text : undefined });
  return undefined;
}

module.exports = [
  {
    name: "drafts",
    clientData: true, // posts carry brokers' and owners' numbers
    aliases: ["inbox", "draft", "musawadat"],
    category: "realestate",
    description:
      "مسودات العقارات — units waiting for a look before they become listings: posts you forward to the bot in your private chat (the text and its photos, several units in a row are split), and posts from a channel added with .channel. Each draft shows the card it would make, its photos, phone numbers found in the post (kept private, never on the card), a possible duplicate and what is missing. “save 3” makes it a listing with its photos (add or fix details after it: “save 3 السعر: 3.2 مليون”), “save all” saves every draft that reads as a property, “del 3” deletes one. “off” stops collecting forwarded posts. Owner and sudo users.",
    usage: "[<draft> | save <draft>|all [details] | del <draft>|all | off | on]",
    examples: [".drafts", ".drafts 3", ".drafts save 3", ".drafts save 3 السعر: 3.2 مليون\nالمالك: أبو أحمد 0100 123 4567", ".drafts save all", ".drafts del 3", ".drafts off"],
    permission: "sudo",
    cooldown: 2,
    async run(ctx) {
      const p = ctx.prefix;
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const direct = idOf(sub);
      if (direct) {
        const d = drafts.get(ctx.state, direct);
        if (!d) throw new UserError(`There is no draft #${direct} (${p}drafts).`);
        return show(ctx, d);
      }
      if (sub === "off" || sub === "on") {
        drafts.setOff(ctx.state, sub === "off");
        return ctx.reply(sub === "off" ? `⏹️ Forwarded posts are no longer collected. Turn it back on: ${p}drafts on` : "✅ Posts you forward to me (with their photos) are collected as drafts.");
      }
      if (sub === "save" || sub === "add" || sub === "حفظ") {
        if (arg === "all" || arg === "الكل") {
          const done = [];
          const left = [];
          for (const d of drafts.open(ctx.state)) {
            try {
              const l = drafts.save(ctx.state, ctx.config, d.id, { by: ctx.sender, ownerNumber: owner(ctx) });
              done.push(`#${l.id}`);
            } catch {
              left.push(`#${d.id}`);
            }
          }
          if (!done.length && !left.length) return ctx.reply("No drafts waiting.");
          return ctx.reply(`✅ ${done.length} saved as listings: ${done.join("، ") || "—"}${left.length ? `\n✏️ Not clear what kind of property (still drafts): ${left.join("، ")} — ${p}drafts save <number> النوع: شقة` : ""}`);
        }
        const id = idOf(arg);
        if (!id) throw new UserError(`Which draft? ${p}drafts save 3`);
        const d = drafts.get(ctx.state, id);
        const dup = d && re.findDuplicate(ctx.state, drafts.fieldsOf(d, owner(ctx)));
        const l = drafts.save(ctx.state, ctx.config, id, { edits: editsAfter(ctx), by: ctx.sender, ownerNumber: owner(ctx) });
        return ctx.reply(
          `✅ Draft #${id} is now listing *#${l.id}* with ${l.photos || 0} photo(s).\n\n${re.card(l, re.agent(ctx.state))}${dup ? `\n\n⚠️ It looks like #${dup.id}. If it's the same: ${p}listing del ${l.id}` : ""}\n\nFlyer: ${p}flyer ${l.id} · clients it suits: ${p}listing match ${l.id}`,
        );
      }
      if (sub === "del" || sub === "delete" || sub === "remove" || sub === "مسح") {
        if (arg === "all" || arg === "الكل") {
          const all = drafts.open(ctx.state);
          for (const d of all) drafts.remove(ctx.state, ctx.config, d.id);
          return ctx.reply(`🗑️ ${all.length} draft(s) deleted.`);
        }
        const id = idOf(arg);
        if (!id) throw new UserError(`Which draft? ${p}drafts del 3`);
        drafts.remove(ctx.state, ctx.config, id);
        return ctx.reply(`🗑️ Draft #${id} deleted, with its photos.`);
      }
      if (sub) throw new UserError(`Usage: ${p}drafts · ${p}drafts 3 · ${p}drafts save 3 · ${p}drafts del 3`);
      const list = drafts.open(ctx.state);
      if (!list.length) {
        return ctx.reply(
          `📥 No drafts waiting.\nForward a unit's post with its photos to me here, or add your channel: ${p}channel add <link>${drafts.isOff(ctx.state) ? `\n(Collecting forwarded posts is off: ${p}drafts on)` : ""}`,
        );
      }
      return ctx.reply(
        [
          `📥 *Drafts* (${list.length}${list.length >= drafts.MAX_OPEN ? `, the most that can wait` : ""})`,
          "",
          ...list.slice(0, 30).map((d) => drafts.line(ctx.state, d, owner(ctx))),
          list.length > 30 ? `… and ${list.length - 30} more` : null,
          "",
          `Look at one: ${p}drafts 3 · save: ${p}drafts save 3 · all: ${p}drafts save all · delete: ${p}drafts del 3`,
          `Drafts untouched for ${Math.round(drafts.EXPIRE_AFTER / 86400000)} days are deleted.`,
        ]
          .filter((x) => x !== null)
          .join("\n"),
      );
    },
  },
  {
    name: "channel",
    aliases: ["channels", "qanah"],
    category: "realestate",
    description:
      "قنوات واتساب — reads a WhatsApp channel's posts as listings: “add <link>” (the channel's Share link) makes the bot follow it, and each new post (its text and photos) becomes a draft to check in .drafts, or with “auto” a listing straight away (a post that doesn't read as a property still waits as a draft). “import 1 30” brings in the channel's latest posts (up to 50). “list”, “del 1”, and “auto 1 on|off”. Owner only.",
    usage: "add <link> [auto] | list | import <channel> [count] | auto <channel> on|off | del <channel>",
    examples: [".channel add https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXXXX", ".channel add https://whatsapp.com/channel/0029Va… auto", ".channel list", ".channel import 1 30", ".channel auto 1 off", ".channel del 1"],
    permission: "owner",
    cooldown: 3,
    async run(ctx) {
      const p = ctx.prefix;
      const [sub = "list", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const all = channels.list(ctx.state);
      const pick = (s) => all[(idOf(s) || 0) - 1] || null;
      if (sub === "add" || sub === "follow") {
        const auto = /\bauto\b|تلقائي/i.test(ctx.text);
        const c = await channels.add(ctx.state, ctx.sock, ctx.args[1], { by: ctx.sender, notify: ctx.chatId, auto });
        return ctx.reply(
          `✅ Reading the channel *${c.name}*.\nEach new post (text and photos) ${auto ? "becomes a listing straight away (one that doesn't read as a property waits in .drafts)" : `becomes a draft; you get it here to check, then ${p}drafts save <number>`}.\nBring in its recent posts: ${p}channel import ${all.findIndex((x) => x.jid === c.jid) + 1 || all.length + 1} 20`,
        );
      }
      if (sub === "del" || sub === "remove" || sub === "stop") {
        const c = pick(arg);
        if (!c) throw new UserError(`Which channel? ${p}channel list`);
        channels.remove(ctx.state, c.jid);
        return ctx.reply(`⏹️ No longer reading *${c.name}*. (The bot still follows it in WhatsApp; unfollow it from the phone if you like.)`);
      }
      if (sub === "auto") {
        const c = pick(arg);
        const on = String(ctx.args[2] || "").toLowerCase();
        if (!c || !["on", "off"].includes(on)) throw new UserError(`Usage: ${p}channel auto 1 on|off`);
        await channels.add(ctx.state, ctx.sock, c.jid, { by: c.by, notify: c.notify, auto: on === "on" });
        return ctx.reply(on === "on" ? `✅ *${c.name}*: posts become listings straight away.` : `✅ *${c.name}*: posts wait as drafts for you to check.`);
      }
      if (sub === "import" || sub === "fetch") {
        const c = pick(arg);
        if (!c) throw new UserError(`Which channel? ${p}channel list`);
        const r = await channels.fetchRecent(ctx.app, c.jid, ctx.args[2] || 20);
        if (!r.posts) return ctx.reply(`Couldn't read past posts from *${c.name}* (WhatsApp sent none back). New posts still come in as drafts.`);
        return ctx.reply(`📥 *${c.name}*: ${r.posts} recent post(s) read, ${r.collected} new draft(s). They come to you here to check in about 2 minutes, or now: ${p}drafts`);
      }
      if (sub !== "list") throw new UserError(`Usage: ${p}channel add <link> · ${p}channel list · ${p}channel import 1 20 · ${p}channel del 1`);
      if (!all.length) return ctx.reply(`No channels yet. Add yours with its link (channel info → Share): ${p}channel add https://whatsapp.com/channel/…`);
      return ctx.reply(
        [`📢 *Channels read as listings* (${all.length})`, "", ...all.map((c, i) => `${i + 1}. *${c.name}*${c.auto ? " · ⚡ auto" : " · 📥 drafts"}`), "", `${p}channel import <number> 20 · ${p}channel auto <number> on|off · ${p}channel del <number>`].join("\n"),
      );
    },
  },
];
