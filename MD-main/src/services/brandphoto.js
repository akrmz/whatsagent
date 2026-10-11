"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const re = require("./realestate");
const img = require("./reimages");

/**
 * Listing photos as clients get them (cards, ".lead send", campaigns): with ".agent watermark
 * on", the agent's name and number in a corner (or ".agent wmtext …"), so a photo forwarded on
 * carries the agent's contact rather than only another broker's mark. The original stays as it
 * is (backups, fingerprints and the designs use it); the marked copy is cached beside it as
 * <n>.wm-<hash>.jpg and made again when the text or the photo changes. Flyers and stories carry
 * the contact already and aren't marked.
 */

const markText = (state) => {
  const a = re.agent(state);
  if (!a.watermark) return null;
  return (a.wmtext || [a.name, a.phone].filter(Boolean).join(" · ")).trim() || null;
};

/** Removes a listing's marked copies (its photos were reordered or deleted). */
function clearCache(config, id) {
  const dir = path.dirname(re.photoPath(config, id, 1));
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (/^\d+\.wm-[0-9a-f]+\.jpg$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
}

/**
 * The photo file as a client should get it (the n-th photo of the listing). @returns {Promise<Buffer|null>}
 * null without that photo.
 */
async function forClients({ state, config }, l, n = 1) {
  const file = re.photoPath(config, l.id, n);
  if (!fs.existsSync(file)) return null;
  const text = markText(state);
  if (!text) return fs.readFileSync(file);
  const st = fs.statSync(file);
  const hash = crypto.createHash("sha1").update(`${text}|${st.size}|${st.mtimeMs}|1`).digest("hex").slice(0, 10);
  const cached = path.join(path.dirname(file), `${n}.wm-${hash}.jpg`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  try {
    const marked = await img.watermark(fs.readFileSync(file), text);
    for (const f of fs.readdirSync(path.dirname(file))) if (f.startsWith(`${n}.wm-`) && f !== path.basename(cached)) fs.rmSync(path.join(path.dirname(file), f), { force: true });
    fs.writeFileSync(cached, marked, { mode: 0o600 });
    return marked;
  } catch {
    return fs.readFileSync(file); // a photo sharp can't read: as it is
  }
}

module.exports = { forClients, clearCache, markText };
