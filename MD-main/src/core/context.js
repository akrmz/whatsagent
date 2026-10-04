"use strict";

const { normalizeJid, isGroup } = require("./identity");
const { unwrap, findMedia, downloadMedia } = require("./media");

/** Extracts the user-visible text of a message (text, captions, button/list replies). */
function getText(content) {
  if (!content) return "";
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ""
  );
}

function getContextInfo(content) {
  if (!content) return null;
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && value.contextInfo) return value.contextInfo;
  }
  return null;
}

/** Parses "<prefix>name arg1 arg2" keeping the original casing of arguments. */
function parseCommand(body, prefix) {
  if (!body || !body.startsWith(prefix)) return null;
  const rest = body.slice(prefix.length).trimStart();
  const match = rest.match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return null;
  const text = match[2].trim();
  return { name: match[1].toLowerCase(), text, args: text ? text.split(/\s+/) : [] };
}

/**
 * Builds the object every command and listener receives as `ctx`.
 * See docs/ADDING_FEATURES.md for the full field list.
 */
function buildContext(app, sock, msg) {
  const content = unwrap(msg.message);
  const chatId = msg.key.remoteJid;
  const fromMe = Boolean(msg.key.fromMe);
  const botJid = normalizeJid(sock.user?.id);
  const sender = fromMe ? botJid : normalizeJid(msg.key.participant || chatId);
  const contextInfo = getContextInfo(content);
  const isGroupChat = isGroup(chatId);
  const level = app.permissions.levelOf({ sender, fromMe });
  const memo = {};

  const ctx = {
    app,
    sock,
    msg,
    content,
    config: app.config,
    log: app.log,
    state: app.state,
    chatId,
    isGroup: isGroupChat,
    fromMe,
    sender,
    senderName: msg.pushName || "",
    botJid,
    body: getText(content).trim(),
    level,
    isOwner: level === "owner",
    isSudoOrOwner: level === "owner" || level === "sudo",
    mentions: contextInfo?.mentionedJid || [],
    quoted: contextInfo?.quotedMessage
      ? {
          message: unwrap(contextInfo.quotedMessage),
          sender: contextInfo.participant || "",
          id: contextInfo.stanzaId || "",
        }
      : null,
    // Filled in by the dispatcher for commands:
    command: null,
    commandName: "",
    args: [],
    text: "",
    prefix: app.config.bot.prefix,

    /** Reply in the same chat, quoting the triggering message. */
    reply(payload, options = {}) {
      const message = typeof payload === "string" ? { text: payload } : payload;
      return sock.sendMessage(chatId, message, { quoted: msg, ...options });
    },
    /** Send to the same chat without quoting. */
    send(payload, options = {}) {
      const message = typeof payload === "string" ? { text: payload } : payload;
      return sock.sendMessage(chatId, message, options);
    },
    react(emoji) {
      return sock.sendMessage(chatId, { react: { text: emoji, key: msg.key } }).catch(() => {});
    },
    groupMetadata() {
      if (!isGroupChat) return Promise.resolve(null);
      memo.meta ||= app.groups.get(sock, chatId);
      return memo.meta;
    },
    async isSenderAdmin() {
      if (!isGroupChat) return false;
      const meta = await ctx.groupMetadata();
      return app.permissions.isAdminIn(meta?.participants || [], sender);
    },
    async isBotAdmin() {
      if (!isGroupChat) return false;
      const meta = await ctx.groupMetadata();
      const ids = [sock.user?.id, sock.user?.lid].filter(Boolean);
      return ids.some((id) => app.permissions.isAdminIn(meta?.participants || [], id));
    },
    /** First @mention, else the author of the replied-to message, else null. */
    target() {
      return ctx.mentions[0] || ctx.quoted?.sender || null;
    },
    /** Finds media in this message or the replied-to one (see core/media.findMedia). */
    findMedia(options) {
      return findMedia(msg, options);
    },
    /** Downloads media found by findMedia, enforcing MAX_MEDIA_MB. */
    download(media, maxBytes = app.config.limits.mediaBytes) {
      return downloadMedia(media, maxBytes);
    },
  };
  return ctx;
}

module.exports = { buildContext, getText, getContextInfo, parseCommand };
