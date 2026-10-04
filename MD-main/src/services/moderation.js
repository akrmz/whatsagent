"use strict";

const { files, groupData } = require("./settings");
const { at } = require("./targets");

/** Adds a warning; kicks and resets the counter at WARN_LIMIT. Returns { count, kicked }. */
async function warnUser(ctx, user, reason) {
  const limit = ctx.config.limits.warnLimit;
  const store = files.warnings(ctx.state);
  const count = store.update((w) => {
    w[ctx.chatId] ||= {};
    w[ctx.chatId][user] = (w[ctx.chatId][user] || 0) + 1;
    return w[ctx.chatId][user];
  });
  if (count >= limit) {
    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [user], "remove");
    store.update((w) => delete w[ctx.chatId][user]);
    await ctx.send({ text: `🚫 ${at(user)} was removed after ${limit} warnings${reason ? ` (${reason})` : ""}.`, mentions: [user] });
    return { count, kicked: true };
  }
  await ctx.send({ text: `⚠️ ${at(user)} warning ${count}/${limit}${reason ? ` for ${reason}` : ""}.`, mentions: [user] });
  return { count, kicked: false };
}

/** Deletes a message in a group (requires bot admin). */
function deleteMessage(ctx, key = ctx.msg.key) {
  return ctx.sock.sendMessage(ctx.chatId, { delete: { ...key, remoteJid: ctx.chatId, fromMe: false } });
}

/**
 * Applies the configured action for a rule violation.
 * action: "delete" | "kick" | "warn"
 */
async function enforce(ctx, action, reason) {
  await deleteMessage(ctx).catch(() => {});
  const user = ctx.sender;
  if (action === "kick") {
    await ctx.sock.groupParticipantsUpdate(ctx.chatId, [user], "remove");
    return ctx.send({ text: `🚫 ${at(user)} was removed for ${reason}.`, mentions: [user] });
  }
  if (action === "warn") return warnUser(ctx, user, reason);
  return ctx.send({ text: `⚠️ ${at(user)} ${reason} is not allowed here.`, mentions: [user] });
}

/** Shared handler for ".antilink/.antitag/.antibadword on|off|set <action>|get". */
function featureCommand({ key, label, actions }) {
  return async (ctx) => {
    const store = groupData(ctx.state);
    const [sub, value] = ctx.args.map((a) => a.toLowerCase());
    const current = store.data[key][ctx.chatId];
    const p = ctx.prefix;
    if (!sub || !["on", "off", "set", "get"].includes(sub)) {
      return ctx.reply(`*${label.toUpperCase()}*\n\n${p}${key} on\n${p}${key} set ${actions.join(" | ")}\n${p}${key} off\n${p}${key} get`);
    }
    if (sub === "on") {
      if (current?.enabled) return ctx.reply(`${label} is already on.`);
      store.update((d) => (d[key][ctx.chatId] = { enabled: true, action: current?.action || "delete" }));
      return ctx.reply(`✅ ${label} is now ON (action: ${current?.action || "delete"}).`);
    }
    if (sub === "off") {
      store.update((d) => delete d[key][ctx.chatId]);
      return ctx.reply(`✅ ${label} is now OFF.`);
    }
    if (sub === "get") {
      return ctx.reply(`${label}: ${current?.enabled ? "ON" : "OFF"}\nAction: ${current?.action || "delete"}`);
    }
    if (!actions.includes(value)) return ctx.reply(`Choose an action: ${actions.join(", ")}`);
    store.update((d) => (d[key][ctx.chatId] = { enabled: true, action: value }));
    return ctx.reply(`✅ ${label} action set to ${value}.`);
  };
}

module.exports = { warnUser, enforce, deleteMessage, featureCommand };
