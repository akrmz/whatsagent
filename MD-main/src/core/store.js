"use strict";

const { LRU } = require("./lru");

/**
 * In-memory store of recent messages: the last N per chat, for at most M chats.
 * Used by `.delete` and by Baileys' getMessage (message retry). Nothing is written to
 * disk, so other people's messages are not kept in plaintext files.
 */
function createMessageStore({ maxChats = 500, perChat = 20 } = {}) {
  const chats = new LRU({ max: maxChats });

  function add(msg) {
    const jid = msg?.key?.remoteJid;
    if (!jid || !msg.key.id) return;
    let list = chats.get(jid);
    if (!list) {
      list = [];
      chats.set(jid, list);
    }
    list.push(msg);
    if (list.length > perChat) list.splice(0, list.length - perChat);
  }

  function recent(jid) {
    return chats.get(jid) || [];
  }

  /** Baileys getMessage(key) for retries. */
  async function getMessage(key) {
    const found = recent(key.remoteJid).find((m) => m.key.id === key.id);
    return found?.message || undefined;
  }

  return { add, recent, getMessage, size: () => chats.size };
}

module.exports = { createMessageStore };
