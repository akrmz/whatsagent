"use strict";

const { UserError } = require("../core/errors");

/**
 * Domains antilink lets through in a group (.linkallow), e.g. youtube.com.
 * Stored in DATA_DIR/antilink-allow.json as { [group]: ["youtube.com", …] }.
 */

const MAX_DOMAINS = 30;
const DOMAIN_RE = /^(?=.{3,100}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const HOST_RE = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?/gi;

const store = (state) => state.store("antilink-allow", {});
const list = (state, chat) => store(state).data[chat] || [];

/** "https://www.YouTube.com/watch" → "youtube.com" */
function normalize(input) {
  const d = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#:].*$/, "")
    .replace(/^www\./, "");
  if (!DOMAIN_RE.test(d)) throw new UserError(`"${input}" is not a domain like youtube.com`);
  return d;
}

function add(state, chat, input) {
  const d = normalize(input);
  return store(state).update((data) => {
    const set = new Set(data[chat] || []);
    if (!set.has(d) && set.size >= MAX_DOMAINS) throw new UserError(`At most ${MAX_DOMAINS} allowed domains per group.`);
    set.add(d);
    data[chat] = [...set].sort();
    return d;
  });
}

function remove(state, chat, input) {
  const d = normalize(input);
  return store(state).update((data) => {
    const before = (data[chat] || []).length;
    data[chat] = (data[chat] || []).filter((x) => x !== d);
    if (!data[chat].length) delete data[chat];
    return before !== (data[chat] || []).length;
  });
}

/** All hosts mentioned in a message. */
const hostsIn = (text) => [...String(text || "").matchAll(HOST_RE)].map((m) => m[1].toLowerCase());

/** True when every link in the text is on an allowed domain (or a subdomain of one). */
function allAllowed(state, chat, text) {
  const allowed = list(state, chat);
  const hosts = hostsIn(text);
  if (!allowed.length || !hosts.length) return false;
  return hosts.every((h) => allowed.some((d) => h === d || h.endsWith(`.${d}`)));
}

module.exports = { add, remove, list, allAllowed, hostsIn, normalize };
