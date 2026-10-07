"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");
const tar = require("./tar");
const { UserError } = require("../core/errors");

/**
 * Listing photos backup (.backup photos / .restore): a .tar.gz of DATA_DIR/listings/<id>/<n>.jpg.
 * Restoring is strict, because the archive comes from a chat:
 *   - only entries named exactly "listings/<id>/<n>.jpg" (numbers) are used; the path written to
 *     is built from those numbers, never from the name, so nothing can land outside the folder
 *   - each must be a JPEG, at most 10 MB, for a listing that exists, photo 1–10
 */

const MAX_SEND_BYTES = 95 * 1024 * 1024; // WhatsApp documents: keep well below its limit
const NAME_RE = /^listings\/(\d{1,7})\/(\d{1,2})\.jpg$/;
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function create(state, config) {
  const entries = [];
  for (const l of re.all(state)) {
    for (const p of re.photos(config, l)) entries.push({ name: `listings/${l.id}/${path.basename(p)}`, data: fs.readFileSync(p) });
  }
  if (!entries.length) throw new UserError("No listing has photos yet.");
  const buffer = tar.pack(entries);
  if (buffer.length > MAX_SEND_BYTES) throw new UserError(`The photos are ${Math.round(buffer.length / 1048576)} MB, too big to send on WhatsApp. Copy the folder ${path.join(config.paths.data, "listings")} from the server instead.`);
  return { buffer, count: entries.length, listings: new Set(entries.map((e) => e.name.split("/")[1])).size };
}

const isArchive = (buffer) => buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

/** What the archive holds, and which photos would be restored. Changes nothing. */
function inspect(state, buffer) {
  let entries;
  try {
    entries = tar.unpack(buffer);
  } catch (err) {
    throw new UserError(`That isn't a photos backup (${err.message}).`);
  }
  const ok = [];
  const skipped = [];
  for (const e of entries) {
    if (e.type === "dir") continue; // folders in archives made with a normal tar
    if (e.type !== "file") {
      skipped.push(`${e.name.slice(0, 60)}: not a regular file (${e.type})`);
      continue;
    }
    const m = e.name.match(NAME_RE);
    if (!m) {
      skipped.push(`${e.name.slice(0, 60)}: not a listing photo`);
      continue;
    }
    const [id, n] = [Number(m[1]), Number(m[2])];
    if (n < 1 || n > re.MAX_PHOTOS) skipped.push(`${e.name}: photo number out of range`);
    else if (!isJpeg(e.data)) skipped.push(`${e.name}: not a JPEG`);
    else if (!re.get(state, id)) skipped.push(`${e.name}: listing #${id} doesn't exist`);
    else ok.push({ id, n, data: e.data });
  }
  return { ok, skipped };
}

/** Writes the photos and updates each listing's photo count. */
function restore(state, config, buffer) {
  const { ok, skipped } = inspect(state, buffer);
  const touched = new Map();
  for (const { id, n, data } of ok) {
    const file = re.photoPath(config, id, n); // built from the numbers, not from the archive's name
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(`${file}.tmp`, data);
    fs.renameSync(`${file}.tmp`, file);
    touched.set(id, Math.max(touched.get(id) || 0, n));
  }
  for (const [id, highest] of touched) {
    // Count the photos now present, in order (1, 2, 3 …), as the listing expects.
    let count = 0;
    while (count < Math.max(highest, re.get(state, id).photos || 0) && fs.existsSync(re.photoPath(config, id, count + 1))) count++;
    re.update(state, id, { photos: count });
  }
  return { written: ok.length, listings: touched.size, skipped };
}

module.exports = { create, inspect, restore, isArchive };
