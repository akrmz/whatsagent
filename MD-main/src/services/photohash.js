"use strict";

const fs = require("node:fs");
const sharp = require("sharp");
const re = require("./realestate");

/**
 * The same unit under another description: brokers repost a unit with new words and a slightly
 * different price, but usually the same photos. Each listing photo gets a fingerprint (a 64-bit
 * difference hash: the picture shrunk to 9×8 greys, each pixel compared with the next), which a
 * copy keeps through resizing, recompression and small edits. A draft or a new photo whose
 * fingerprint is close to a listing's is pointed out. Only a hint: a developer's renders are shared
 * by many units of the same compound.
 *   DATA_DIR/photohashes.json { items: { [listingId]: { [n]: "16 hex" } } }
 */

const NEAR = 6; // differing bits out of 64 for "the same photo"
const PER_RUN = 40; // photos fingerprinted per minute in the background

const store = (state) => state.store("photohashes", { items: {} });

/** The fingerprint of a picture (any format sharp reads), as 16 hex characters. */
async function dhash(buffer) {
  const px = await sharp(buffer, { limitInputPixels: 64e6, animated: false }).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

/** Set bits in a 32-bit number (the usual SWAR count). */
function bits32(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** How many of the 64 bits differ (two 32-bit halves: much faster than BigInt for a whole catalogue). */
const distance = (a, b) => bits32((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) + bits32((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0);

/** Fingerprints the listing photos that have none yet (a few per run). @returns {Promise<number>} done */
async function backfill(state, config, max = PER_RUN) {
  let done = 0;
  for (const l of re.all(state)) {
    if (done >= max) break;
    const have = store(state).data.items[l.id] || {};
    for (let n = 1; n <= (l.photos || 0) && done < max; n++) {
      if (have[n]) continue;
      const file = re.photoPath(config, l.id, n);
      if (!fs.existsSync(file)) continue;
      try {
        const h = await dhash(fs.readFileSync(file));
        store(state).update((d) => ((d.items[l.id] ||= {})[n] = h));
      } catch {
        store(state).update((d) => ((d.items[l.id] ||= {})[n] = "x")); // unreadable: don't retry it forever
      }
      done++;
    }
  }
  // Deleted listings' fingerprints go.
  const ids = new Set(re.all(state).map((l) => String(l.id)));
  if (Object.keys(store(state).data.items).some((id) => !ids.has(id))) store(state).update((d) => Object.keys(d.items).forEach((id) => !ids.has(id) && delete d.items[id]));
  return done;
}

/**
 * Listings with a photo close to one of these pictures, closest first: [{ id, distance }].
 * `exclude`: a listing id not to compare with (its own photos).
 */
async function sameAs(state, buffers, { exclude } = {}) {
  const mine = [];
  for (const b of buffers) {
    try {
      mine.push(await dhash(b));
    } catch {
      // not a picture
    }
  }
  if (!mine.length) return [];
  const best = new Map();
  for (const [id, photos] of Object.entries(store(state).data.items)) {
    if (Number(id) === Number(exclude) || !re.get(state, Number(id))) continue;
    for (const h of Object.values(photos)) {
      if (h === "x") continue;
      for (const m of mine) {
        const dist = distance(h, m);
        if (dist <= NEAR && dist < (best.get(id) ?? 99)) best.set(id, dist);
      }
    }
  }
  return [...best].map(([id, dist]) => ({ id: Number(id), distance: dist })).sort((a, b) => a.distance - b.distance || a.id - b.id);
}

/** "⚠️ نفس صور #12، #15 — لو نفس الوحدة: …" or "" */
const line = (matches, { p = ".", listing } = {}) =>
  matches.length ? `\n⚠️ صورها زي صور ${matches.slice(0, 3).map((m) => `#${m.id}`).join("، ")} — ممكن تكون نفس الوحدة من سمسار تاني${listing ? ` (لو كده: ${p}listing del ${listing})` : ""}` : "";

function startPhotoHashLoop(app) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await backfill(app.state, app.config);
    } catch (err) {
      app.log.warn({ err: err.message }, "photo fingerprints failed");
    } finally {
      busy = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { dhash, distance, backfill, sameAs, line, startPhotoHashLoop, NEAR };
