"use strict";

const { LRU } = require("../core/lru");

/**
 * Choosing a group from the owner's private chat: by its number in the last ".groups" list, or
 * by its ID ("120363…@g.us", or just the digits). Used by .groups, .leavegroup and .in.
 */

// The last .groups list per chat, so "3" can refer to it.
const lastList = new LRU({ max: 10, ttlMs: 30 * 60 * 1000 });

/** Every group the bot is in, the biggest first. */
async function allGroups(sock) {
  const groups = Object.values((await sock.groupFetchAllParticipating()) || {});
  return groups.sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0) || String(a.id).localeCompare(String(b.id)));
}

const remember = (chat, groups) => lastList.set(chat, groups.map((g) => g.id));
const forget = (chat) => lastList.delete(chat);

const GROUP_ID = /^(\d{10,25}(?:-\d{6,12})?)(?:@g\.us)?$/;

/**
 * One group ID from "3" (the .groups list, fetched again if it has expired) or an ID.
 * @returns {Promise<string|null>}
 */
async function resolve(ctx, token) {
  const t = String(token || "").trim();
  const id = t.match(GROUP_ID);
  if (id) return `${id[1]}@g.us`;
  if (!/^\d{1,3}$/.test(t)) return null;
  let list = lastList.get(ctx.chatId);
  if (!list) {
    const groups = await allGroups(ctx.sock);
    remember(ctx.chatId, groups);
    list = groups.map((g) => g.id);
  }
  return list[Number(t) - 1] || null;
}

module.exports = { allGroups, remember, forget, resolve, lastList, GROUP_ID };
