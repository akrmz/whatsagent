"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");

/**
 * Where the disk goes (.storage), and what can go without losing anything that matters
 * (.storage clean): watermarked copies (made again when needed), the extra photos and the videos
 * of units sold or rented more than 90 days ago (their first photo stays, for the history), and
 * temporary files older than a day. Nothing else is ever deleted here.
 */

const SOLD_FOR = 90 * 24 * 3600 * 1000;
const TMP_AGE = 24 * 3600 * 1000;

/** Bytes and files under a folder (not following links). */
function sizeOf(dir, filter = () => true) {
  let bytes = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { bytes, files };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else if (filter(e.name, p)) {
        bytes += fs.statSync(p).size;
        files++;
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
/** The bot's own temporary folder: named tmp/temp, inside the bot's folder or beside its data folder, holding neither the data, the session nor the bot (never a shared system folder). */
const safeTmp = (config) => {
  const tmp = path.resolve(config.paths.tmp);
  const data = path.resolve(config.paths.data);
  const own = (inside(tmp, ROOT_DIR) && tmp !== ROOT_DIR) || path.dirname(tmp) === path.dirname(data); // MD-main/tmp, or beside the data folder
  return /^(tmp|temp)$/i.test(path.basename(tmp)) && own && !inside(data, tmp) && !inside(path.resolve(config.paths.session), tmp) && !inside(ROOT_DIR, tmp);
};

const listingsDir = (config) => path.join(config.paths.data, "listings");
const isCache = (name) => /^\d+\.wm-[0-9a-f]+\.jpg$/.test(name);
const isVideo = (name) => /^v\d+\.mp4$/.test(name);
const isPhoto = (name) => /^\d+\.jpg$/.test(name);

/** Sold or rented more than 90 days ago, with something to clear. */
function oldGone(state, now = Date.now()) {
  return re.all(state).filter((l) => ["sold", "rented"].includes(l.status) && now - (l.statusAt || l.updated || l.created) > SOLD_FOR && ((l.photos || 0) > 1 || (l.videos || 0) > 0));
}

/** The report: { parts: [{ name, bytes, files }], free, cleanable } */
function report(app, now = Date.now()) {
  const { config } = app;
  const data = config.paths.data;
  const parts = [
    { name: "📷 listing photos", ...sizeOf(listingsDir(config), (n) => isPhoto(n)) },
    { name: "🎥 listing videos", ...sizeOf(listingsDir(config), (n) => isVideo(n)) },
    { name: "🏷️ watermarked copies", ...sizeOf(listingsDir(config), (n) => isCache(n)) },
    { name: "📥 drafts", ...sizeOf(path.join(data, "drafts")) },
    { name: "🏠 sellers' photos", ...sizeOf(path.join(data, "sellers")) },
    { name: "🗂️ data files", ...sizeOf(data, (n, p) => path.dirname(p) === path.resolve(data) && n.endsWith(".json")) },
    { name: "🧪 temporary files", ...sizeOf(config.paths.tmp) },
    { name: "📱 extra numbers", ...sizeOf(path.resolve(data, "..", "instances")) },
  ];
  return { parts, free: freeBytes(config), cleanable: plan(app, now) };
}

/** Free bytes on the disk that holds the data, or null where it can't be told. */
function freeBytes(config) {
  try {
    const st = fs.statfsSync(config.paths.data);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

/** What .storage clean would remove: { files: [paths], bytes, listings: [ids] } */
function plan(app, now = Date.now()) {
  const { config, state } = app;
  const files = [];
  const listings = [];
  const dir = listingsDir(config);
  // Watermarked copies: made again when a client next gets the photo.
  if (fs.existsSync(dir)) {
    for (const id of fs.readdirSync(dir)) {
      const d = path.join(dir, id);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const f of fs.readdirSync(d)) if (isCache(f)) files.push(path.join(d, f));
    }
  }
  // Units gone for 90 days: the first photo stays, the rest and the videos go.
  for (const l of oldGone(state, now)) {
    listings.push(l.id);
    for (let n = 2; n <= (l.photos || 0); n++) files.push(re.photoPath(config, l.id, n));
    for (let n = 1; n <= (l.videos || 0); n++) files.push(path.join(path.dirname(re.photoPath(config, l.id, 1)), `v${n}.mp4`));
  }
  // Temporary files older than a day, only in a real temporary folder (a TMP_DIR set to the bot's
  // own folder by mistake must never lose index.js).
  if (safeTmp(config) && fs.existsSync(config.paths.tmp)) {
    for (const e of fs.readdirSync(config.paths.tmp, { withFileTypes: true })) {
      const p = path.join(config.paths.tmp, e.name);
      if (e.isFile() && now - fs.statSync(p).mtimeMs > TMP_AGE) files.push(p);
    }
  }
  const existing = [...new Set(files)].filter((f) => fs.existsSync(f));
  return { files: existing, bytes: existing.reduce((a, f) => a + fs.statSync(f).size, 0), listings };
}

/** Removes what plan() lists and updates the listings. @returns {{ files, bytes, listings }} */
function clean(app, now = Date.now()) {
  const p = plan(app, now);
  for (const f of p.files) fs.rmSync(f, { force: true });
  for (const id of p.listings) {
    const l = re.get(app.state, id);
    if (!l) continue;
    re.update(app.state, id, { photos: Math.min(1, l.photos || 0), videos: 0 }, l.updated); // not a change of the listing
    require("./photohash").forget(app.state, id);
  }
  return p;
}

const mb = (bytes) => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${(bytes / 1048576).toFixed(1)} MB`);

module.exports = { report, plan, clean, freeBytes, sizeOf, oldGone, safeTmp, mb, SOLD_FOR };
