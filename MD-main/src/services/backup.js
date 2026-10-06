"use strict";

const fs = require("node:fs");
const { UserError } = require("../core/errors");
const vars = require("./vars");
const cookies = require("./cookies");
const { HOSTS } = require("./sites");

/**
 * Backup and restore of the bot's settings and lists (everything in DATA_DIR) as one JSON
 * file, sent to and from the owner in WhatsApp. The WhatsApp session is never included.
 * A "full" backup also contains the settings set from chat (API keys) and saved cookies.
 */

const FORMAT = "whatsapp-bot-backup";
const SECRET_FILES = new Set([vars.FILE.replace(/\.json$/, "")]); // env-overrides
const SKIP = new Set(["pending-notice"]);
const MAX_BYTES = 20 * 1024 * 1024;

function create(app, { full = false, version } = {}) {
  const files = {};
  for (const name of app.state.names()) {
    if (SKIP.has(name) || (!full && SECRET_FILES.has(name))) continue;
    try {
      files[`${name}.json`] = JSON.parse(fs.readFileSync(`${app.state.dataDir}/${name}.json`, "utf8"));
    } catch {
      /* unreadable file: skip */
    }
  }
  if (full) {
    for (const site of cookies.savedSites(app.config)) files[`cookies/${site}.txt`] = fs.readFileSync(cookies.fileFor(app.config, site), "utf8");
  }
  return { format: FORMAT, version, created: new Date().toISOString(), full, files };
}

/** Validates a backup and returns what it contains, without changing anything. */
function inspect(buffer) {
  if (buffer.length > MAX_BYTES) throw new UserError("That file is too big to be a bot backup.");
  let backup;
  try {
    backup = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new UserError("That is not a bot backup file (not JSON).");
  }
  if (backup?.format !== FORMAT || !backup.files || typeof backup.files !== "object") throw new UserError("That is not a backup made with .backup.");
  const stores = [];
  const cookieSites = [];
  let overrides = null;
  for (const [name, value] of Object.entries(backup.files)) {
    const store = name.match(/^([A-Za-z0-9_-]{1,60})\.json$/);
    const cookie = name.match(/^cookies\/([a-z]+)\.txt$/);
    if (store && SECRET_FILES.has(store[1])) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        overrides = Object.fromEntries(Object.entries(value).filter(([k, v]) => vars.BY_KEY.has(k) && typeof v === "string"));
      }
    } else if (store && !SKIP.has(store[1]) && value && typeof value === "object") {
      stores.push([store[1], value]);
    } else if (cookie && Object.hasOwn(HOSTS, cookie[1]) && typeof value === "string") {
      cookieSites.push([cookie[1], value]);
    }
  }
  return { backup, stores, cookieSites, overrides };
}

/** Restores everything in the backup. @returns {Promise<{ stores: string[], cookies: string[], settings: string[] }>} */
async function restore(app, buffer) {
  const { stores, cookieSites, overrides } = inspect(buffer);
  for (const [name, value] of stores) app.state.replace(name, value);
  for (const [site, text] of cookieSites) cookies.save(app.config, site, cookies.parse(text, site).cookies);
  let settings = [];
  if (overrides) {
    // Make the chat settings exactly those of the backup.
    const changes = Object.fromEntries(Object.keys(app.overrides).map((k) => [k, null]));
    Object.assign(changes, overrides);
    await vars.apply(app, changes);
    settings = Object.keys(overrides);
  }
  return { stores: stores.map(([n]) => n), cookies: cookieSites.map(([s]) => s), settings };
}

module.exports = { create, inspect, restore, FORMAT };
