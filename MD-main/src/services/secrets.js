"use strict";

const { parseCommand } = require("../core/context");

/**
 * Helpers for commands that receive secrets (API keys, cookies) in a message.
 */

// Commands whose message can contain a secret. Antidelete never keeps a copy of these.
const SECRET_COMMANDS = new Set(["setvar", "setai", "setcookie"]);

/** True if this message runs one of the secret-carrying commands (by name or alias). */
function isSecretCommand(app, body) {
  const parsed = parseCommand(body, app.config.bot.prefix);
  const command = parsed && app.commands.byName.get(parsed.name);
  return Boolean(command && SECRET_COMMANDS.has(command.name));
}

/**
 * Removes the message that carried a secret, as far as WhatsApp allows:
 *  - sent from the bot's own account (fromMe): deleted for everyone
 *  - otherwise only the bot's copy can be removed ("delete for me"); the sender must
 *    delete their own copy.
 * @returns {Promise<boolean>} true if the message is gone for the sender too
 */
async function tryDeleteSecretMessage(ctx) {
  if (ctx.fromMe) {
    try {
      await ctx.sock.sendMessage(ctx.chatId, { delete: ctx.msg.key });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await ctx.sock.chatModify?.({ deleteForMe: { deleteMedia: true, key: ctx.msg.key, timestamp: Number(ctx.msg.messageTimestamp) || Math.floor(Date.now() / 1000) } }, ctx.chatId);
  } catch {
    /* best effort */
  }
  return false;
}

module.exports = { SECRET_COMMANDS, isSecretCommand, tryDeleteSecretMessage };
