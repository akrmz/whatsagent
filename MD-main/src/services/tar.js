"use strict";

const zlib = require("node:zlib");

/**
 * A minimal .tar.gz writer and reader (POSIX ustar), enough for photo backups without a
 * dependency. Only regular files are written. The reader returns every entry with its type,
 * but only reads the content of regular files ("file"); folders and links come back without
 * data. Names are returned as-is: callers must validate them and never join them onto a path.
 */

const BLOCK = 512;

const octal = (n, len) => `${n.toString(8).padStart(len - 1, "0")}\0`;

function header(name, size, mtime) {
  const h = Buffer.alloc(BLOCK, 0);
  if (Buffer.byteLength(name) > 100) throw new Error(`name too long: ${name}`);
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii"); // uid
  h.write(octal(0, 8), 116, "ascii"); // gid
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime / 1000), 12), 136, "ascii");
  h.fill(" ", 148, 156); // checksum field counts as spaces while summing
  h.write("0", 156, "ascii"); // regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}

/** @param {Array<{ name: string, data: Buffer }>} entries @returns {Buffer} .tar.gz */
function pack(entries, now = Date.now()) {
  const parts = [];
  for (const { name, data } of entries) {
    parts.push(header(name, data.length, now), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0)); // end of archive
  return zlib.gzipSync(Buffer.concat(parts));
}

const field = (h, start, len) => {
  const raw = h.subarray(start, start + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? len : end).toString("utf8");
};

/**
 * Reads a .tar.gz. Throws on anything but regular files, on a bad header checksum, and when
 * the limits are exceeded (decompressed size is capped while inflating, so an archive that
 * expands enormously is stopped early).
 * @returns {Array<{ name: string, data: Buffer }>}
 */
function unpack(gz, { maxTotal = 200 * 1024 * 1024, maxEntries = 5000, maxEntryBytes = 10 * 1024 * 1024 } = {}) {
  let tar;
  try {
    tar = zlib.gunzipSync(gz, { maxOutputLength: maxTotal + BLOCK * (maxEntries + 2) * 2 });
  } catch (err) {
    throw new Error(err.code === "ERR_BUFFER_TOO_LARGE" || /too large|maxOutputLength/i.test(err.message) ? "archive too large" : "not a .tar.gz archive", { cause: err });
  }
  const out = [];
  let off = 0;
  while (off + BLOCK <= tar.length) {
    const h = tar.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break; // end of archive
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (parseInt(field(h, 148, 8).trim(), 8) !== sum) throw new Error("damaged archive (header checksum)");
    const type = String.fromCharCode(h[156] || 48);
    const prefix = field(h, 345, 155);
    const name = prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100);
    const size = parseInt(field(h, 124, 12).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("damaged archive (size)");
    if (off + BLOCK + size > tar.length) throw new Error("damaged archive (truncated)");
    if (type === "0") {
      if (size > maxEntryBytes) throw new Error(`file too large in archive (${name})`);
      out.push({ name, type: "file", data: Buffer.from(tar.subarray(off + BLOCK, off + BLOCK + size)) });
    } else {
      // Folders, links, devices …: listed (so the caller can report them) but their content is never read.
      out.push({ name, type: type === "5" ? "dir" : type === "1" || type === "2" ? "link" : "other", data: null });
    }
    if (out.length > maxEntries) throw new Error("too many files in archive");
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

module.exports = { pack, unpack };
