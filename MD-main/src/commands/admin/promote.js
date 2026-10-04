"use strict";

const { resolveTargets, isBot, at } = require("../../services/targets");

function participantAction(action, verb, title) {
  return async (ctx) => {
    let targets = resolveTargets(ctx, { allowNumbers: false });
    if (action !== "promote") targets = targets.filter((t) => !isBot(ctx, t));
    if (action === "remove") targets = targets.filter((t) => !ctx.app.permissions.isOwner(t));
    if (!targets.length) return ctx.reply(`Mention the user(s) or reply to their message to ${verb}.`);
    await ctx.sock.groupParticipantsUpdate(ctx.chatId, targets, action);
    ctx.app.groups.invalidate(ctx.chatId);
    return ctx.send({
      text: `*『 ${title} 』*\n\n${targets.map((t) => `• ${at(t)}`).join("\n")}\n\nBy: ${at(ctx.sender)}`,
      mentions: [...targets, ctx.sender],
    });
  };
}

const base = { category: "admin", permission: "groupAdmin", botAdmin: true, usage: "@user | (reply)" };

module.exports = [
  { ...base, name: "promote", description: "Makes members group admins.", run: participantAction("promote", "promote", "GROUP PROMOTION") },
  { ...base, name: "demote", description: "Removes admin rights from members.", run: participantAction("demote", "demote", "GROUP DEMOTION") },
  {
    ...base,
    name: "kick",
    description: "Removes members from the group. The bot and its owners cannot be kicked.",
    run: participantAction("remove", "kick", "REMOVED"),
  },
];
