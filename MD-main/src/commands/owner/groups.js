"use strict";

const { resolveTargets, at } = require("../../services/targets");
const { stopAll } = require("../../services/automations");
const grouppick = require("../../services/grouppick");
const { overview } = require("../../services/autosoverview");

const INVITE_RE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})/;

const allGroups = (ctx) => grouppick.allGroups(ctx.sock);

const AUTOS = /^(autos?|automations|scheduled|تلقائي)$/i;
const MAX_LISTED = 40;

/** ".groups autos": what runs automatically in each group, by its number, to change it with .in. */
function autosReport(ctx, groups) {
  const p = ctx.prefix;
  const withAutos = [];
  const quiet = [];
  for (const [i, g] of groups.entries()) {
    const lines = overview(ctx.state, g.id, p).map((l) => {
      const cut = l.lastIndexOf(` — ${p}`); // the command hint: the footer says how to change one
      return `   ${cut > 0 ? l.slice(0, cut) : l}`;
    });
    if (lines.length) withAutos.push(`${i + 1}. *${g.subject || "(no name)"}*\n${lines.join("\n")}`);
    else quiet.push(i + 1);
  }
  if (!withAutos.length) return ctx.reply(`Nothing runs automatically in any of the ${groups.length} group(s).\nTurn something on from here: ${p}in 1 autoazkar on · ${p}in 1 autolistings on 10:00`);
  return ctx.reply(
    [
      `⚙️ *Automatic in your groups* (${withAutos.length} of ${groups.length})`,
      "",
      withAutos.slice(0, MAX_LISTED).join("\n\n"),
      withAutos.length > MAX_LISTED ? `\n… and ${withAutos.length - MAX_LISTED} more` : null,
      quiet.length ? `\n💤 Nothing automatic: ${quiet.length > 30 ? `${quiet.length} groups` : quiet.join("، ")}` : null,
      "",
      `Details of one: ${p}in <number> autos · stop its Islamic posts: ${p}in <number> autos off · turn on more: ${p}in <number> autoazkar on`,
    ]
      .filter((x) => x !== null)
      .join("\n"),
  );
}

const base = { category: "owner", permission: "owner", cooldown: 5 };

module.exports = [
  {
    ...base,
    name: "groups",
    aliases: ["listgroups", "grouplist"],
    description: "Lists every group the bot is in, with its number, ID, member count and whether the bot is an admin there. Use the number or the ID with .in to set a group up from your private chat, or with .leavegroup. “autos” shows what runs automatically in each group (azkar, hadith, the wird, the listing of the day, schedules …).",
    usage: "[autos]",
    examples: [".groups", ".groups autos"],
    async run(ctx) {
      const groups = await allGroups(ctx);
      if (!groups.length) return ctx.reply("The bot is not in any group.");
      grouppick.remember(ctx.chatId, groups);
      if (AUTOS.test(ctx.args[0] || "")) return autosReport(ctx, groups);
      const botIds = new Set(ctx.app.identity.aliases(ctx.sock.user?.id).concat(ctx.app.identity.aliases(ctx.sock.user?.lid)));
      const lines = groups.slice(0, 100).map((g, i) => {
        const admin = (g.participants || []).some((p) => p.admin && ctx.app.identity.aliases(p.id).some((a) => botIds.has(a)));
        return `${i + 1}. *${g.subject || "(no name)"}* · ${g.participants?.length || 0} members${admin ? " · 👮 admin" : ""}${g.announce ? " · 🔒" : ""}\n    🆔 ${g.id}`;
      });
      return ctx.reply(
        `👥 *Groups* (${groups.length})\n\n${lines.join("\n")}\n\nSet one up from here, without writing in it: ${ctx.prefix}in <number or ID> <command>, e.g. ${ctx.prefix}in 1 autoazkar on\nLeave one: ${ctx.prefix}leavegroup <number>`,
      );
    },
  },
  {
    ...base,
    name: "leavegroup",
    aliases: ["exitgroup"],
    description: "Makes the bot leave a group by its number from .groups.",
    usage: "<number from .groups>",
    async run(ctx) {
      const n = Number(ctx.args[0]);
      const id = grouppick.lastList.get(ctx.chatId)?.[n - 1];
      if (!id) return ctx.reply(`Send ${ctx.prefix}groups first, then ${ctx.prefix}leavegroup <number>.`);
      const meta = await ctx.app.groups.get(ctx.sock, id).catch(() => null);
      await ctx.sock.sendMessage(id, { text: "👋 Goodbye!" }).catch(() => {});
      await ctx.sock.groupLeave(id);
      const stopped = stopAll(ctx.state, id, { all: true });
      ctx.app.groups.invalidate(id);
      grouppick.forget(ctx.chatId);
      return ctx.reply(`✅ Left *${meta?.subject || id}*.${stopped.length ? `\nStopped there:${stopped.join(", ")}` : ""}`);
    },
  },
  {
    ...base,
    name: "join",
    aliases: ["joingroup"],
    description: "Makes the bot join a group from an invite link.",
    usage: "<chat.whatsapp.com link>",
    examples: [".join https://chat.whatsapp.com/AbCdEf123456"],
    cooldown: 15,
    async run(ctx) {
      const code = (ctx.text.match(INVITE_RE) || [])[1];
      if (!code) return ctx.reply(`Usage: ${ctx.prefix}join https://chat.whatsapp.com/…`);
      try {
        const id = await ctx.sock.groupAcceptInvite(code);
        const meta = id ? await ctx.app.groups.get(ctx.sock, id).catch(() => null) : null;
        return ctx.reply(`✅ Joined${meta?.subject ? ` *${meta.subject}*` : ""}.`);
      } catch (err) {
        ctx.log.warn({ err: err.message }, "join failed");
        return ctx.reply("❌ Couldn't join: the link may be expired or revoked, or the group needs admin approval.");
      }
    },
  },
  {
    ...base,
    name: "block",
    description: "Blocks someone on the bot's WhatsApp account (they can't message or call it). Mention them, reply to them, or give the number.",
    usage: "<@user | reply | number>",
    async run(ctx) {
      const [jid] = resolveTargets(ctx, { max: 1 });
      if (!jid) return ctx.reply(`Usage: ${ctx.prefix}block @user (or reply to them)`);
      if (ctx.app.permissions.levelOf({ sender: jid }) === "owner") return ctx.reply("The owner can't be blocked.");
      await ctx.sock.updateBlockStatus(jid, "block");
      return ctx.reply({ text: `🚫 Blocked ${at(jid)}.`, mentions: [jid] });
    },
  },
  {
    ...base,
    name: "unblock",
    description: "Unblocks someone on the bot's WhatsApp account.",
    usage: "<@user | reply | number>",
    async run(ctx) {
      const [jid] = resolveTargets(ctx, { max: 1 });
      if (!jid) return ctx.reply(`Usage: ${ctx.prefix}unblock @user (or the number)`);
      await ctx.sock.updateBlockStatus(jid, "unblock");
      return ctx.reply({ text: `✅ Unblocked ${at(jid)}.`, mentions: [jid] });
    },
  },
];
