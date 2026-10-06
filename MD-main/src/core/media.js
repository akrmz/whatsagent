"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { heavy } = require("./jobs");

class MediaError extends Error {}

const MEDIA_KEYS = {
  imageMessage: "image",
  videoMessage: "video",
  stickerMessage: "sticker",
  audioMessage: "audio",
  documentMessage: "document",
};

/** Removes wrapper layers (ephemeral, view-once, document-with-caption) around content. */
function unwrap(content) {
  let c = content;
  for (let i = 0; i < 5 && c; i++) {
    const inner =
      c.ephemeralMessage?.message ||
      c.viewOnceMessage?.message ||
      c.viewOnceMessageV2?.message ||
      c.viewOnceMessageV2Extension?.message ||
      c.documentWithCaptionMessage?.message;
    if (!inner) break;
    c = inner;
  }
  return c;
}

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v.toNumber === "function") return v.toNumber();
  if (typeof v.low === "number") return (v.high || 0) * 2 ** 32 + (v.low >>> 0);
  return 0;
}

/**
 * Finds media in a message or the message it replies to.
 * @returns {{ type, content, mimetype, size, seconds, source } | null}
 */
function findMedia(message, { types = Object.values(MEDIA_KEYS), quoted = true, own = true } = {}) {
  const candidates = [];
  const isViewOnceWrapper = (m) => Boolean(m?.viewOnceMessage || m?.viewOnceMessageV2 || m?.viewOnceMessageV2Extension);
  const raw = message?.message || {};
  const self = unwrap(raw);
  if (own) candidates.push({ c: self, source: "self", wrapped: isViewOnceWrapper(raw) });
  const ctx = Object.values(self || {}).find((v) => v && typeof v === "object" && v.contextInfo)?.contextInfo;
  if (quoted && ctx?.quotedMessage) {
    candidates.push({ c: unwrap(ctx.quotedMessage), source: "quoted", wrapped: isViewOnceWrapper(ctx.quotedMessage) });
  }
  for (const { c, source, wrapped } of candidates) {
    for (const [key, type] of Object.entries(MEDIA_KEYS)) {
      if (c?.[key] && types.includes(type)) {
        const content = c[key];
        return {
          type,
          content,
          source,
          mimetype: content.mimetype || "",
          size: toNumber(content.fileLength),
          seconds: toNumber(content.seconds),
          viewOnce: Boolean(content.viewOnce || wrapped),
        };
      }
    }
  }
  return null;
}

/** Downloads WhatsApp media with a byte cap. Checks the declared size before downloading. */
async function downloadMedia(media, maxBytes) {
  if (media.size && media.size > maxBytes) {
    throw new MediaError(`File is too large (${Math.ceil(media.size / 1048576)} MB, limit ${Math.floor(maxBytes / 1048576)} MB).`);
  }
  const stream = await downloadContentFromMessage(media.content, media.type);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy?.();
      throw new MediaError(`File is too large (limit ${Math.floor(maxBytes / 1048576)} MB).`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Creates a private temp folder, runs fn(dir), always deletes the folder. */
async function withTempDir(baseDir, fn) {
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(baseDir || os.tmpdir(), "op-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs ffmpeg without a shell. Input protocols are restricted to local files and pipes,
 * so a hostile media file cannot make ffmpeg fetch URLs or read other files.
 */
function runFfmpeg(ffmpegPath, args, opts) {
  return heavy(() => runFfmpegNow(ffmpegPath, args, opts)); // shared job limit (core/jobs)
}

function runFfmpegNow(ffmpegPath, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const full = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args];
    const proc = spawn(ffmpegPath, full, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stderr.on("data", (d) => {
      if (stderr.length < 4000) stderr += d;
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new MediaError("ffmpeg is not installed on the server.") : err);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new MediaError(signal ? "Media conversion timed out." : `ffmpeg failed: ${stderr.trim().split("\n").pop() || code}`));
    });
  });
}

/** Input options used for every untrusted file. */
const SAFE_INPUT = ["-protocol_whitelist", "file,pipe"];

/** "Stream #0:0: Video: av1 (libdav1d) …" → { video: "av1", audio: "aac" } from ffmpeg's stream list. */
function parseCodecs(stderr) {
  const video = String(stderr).match(/Stream #\d+:\d+[^\n]*?: Video: (\w+)/);
  const audio = String(stderr).match(/Stream #\d+:\d+[^\n]*?: Audio: (\w+)/);
  return { video: video?.[1] || null, audio: audio?.[1] || null };
}

/** The codecs of a local file (ffmpeg -i without an output only prints the stream list). */
function probeCodecs(ffmpegPath, file) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-nostdin", ...SAFE_INPUT, "-i", file], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), 30000);
    proc.stderr.on("data", (d) => {
      if (stderr.length < 20000) stderr += d;
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ video: null, audio: null });
    });
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(parseCodecs(stderr));
    });
  });
}

// What every WhatsApp client plays: H.264 video, AAC (or MP3) audio, in MP4.
const PLAYABLE_VIDEO = new Set(["h264"]);
const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

/** "convert" (re-encode), "remux" (right codecs, other container) or "ok". */
function videoPlan({ video, audio }, ext) {
  if (!video) return "ok"; // not a video, or unreadable: leave it alone
  if (!PLAYABLE_VIDEO.has(video) || (audio && !PLAYABLE_AUDIO.has(audio))) return "convert";
  return ext === "mp4" ? "ok" : "remux";
}

/**
 * Re-encodes (or just re-packs) a video so WhatsApp can play it: H.264 (yuv420p, at most
 * 1280 px on the long side), AAC audio, MP4 with the index at the start.
 */
async function toWhatsAppVideo(ffmpegPath, input, output, { plan, codecs, maxSeconds = 1800 }) {
  const audio = codecs.audio === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"];
  const video =
    plan === "remux"
      ? ["-c:v", "copy"]
      : [
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
          "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        ];
  await runFfmpeg(
    ffmpegPath,
    [...SAFE_INPUT, "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-t", String(maxSeconds), ...video, ...audio, "-movflags", "+faststart", output],
    { timeoutMs: 5 * 60 * 1000 },
  );
}

// ---- Stickers ---------------------------------------------------------------

const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00,
  0x00, 0x00,
]);

/** Adds WhatsApp sticker-pack metadata (EXIF) to a WebP buffer. */
async function addStickerExif(webpBuffer, { pack = "", author = "", emojis = ["🤖"] } = {}) {
  const webp = require("node-webpmux");
  const img = new webp.Image();
  await img.load(webpBuffer);
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": crypto.randomBytes(16).toString("hex"),
      "sticker-pack-name": pack,
      "sticker-pack-publisher": author,
      emojis,
    }),
    "utf8",
  );
  const exif = Buffer.concat([EXIF_HEADER, json]);
  exif.writeUIntLE(json.length, 14, 4);
  img.exif = exif;
  return img.save(null);
}

const STICKER_MAX = 950 * 1024;

/** A 512×512 WebP for a static sticker: fitted on a transparent square, or cropped to it. */
async function staticWebp(buffer, crop) {
  const sharp = require("sharp");
  let out;
  for (const quality of [80, 60, 40]) {
    out = await sharp(buffer, { animated: false, limitInputPixels: 64e6 })
      .rotate()
      .resize(512, 512, { fit: crop ? "cover" : "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality })
      .toBuffer();
    if (out.length <= STICKER_MAX) break;
  }
  return out;
}

/**
 * Converts an image/video/GIF buffer into a WhatsApp sticker (WebP, ≤ ~1 MB).
 * Tries progressively smaller settings until the result fits.
 */
async function toSticker(buffer, { animated = false, crop = false, pack, author, emojis, ffmpegPath = "ffmpeg", tmpDir }) {
  // Pictures are converted with sharp (no ffmpeg needed); only GIFs/videos use ffmpeg.
  if (!animated) return addStickerExif(await staticWebp(buffer, crop), { pack, author, emojis });
  return withTempDir(tmpDir, async (dir) => {
    const input = path.join(dir, "input");
    fs.writeFileSync(input, buffer);
    const attempts = animated
      ? [
          { size: 512, fps: 15, q: 60, t: 6 },
          { size: 512, fps: 12, q: 40, t: 4 },
          { size: 320, fps: 8, q: 30, t: 3 },
          { size: 256, fps: 6, q: 20, t: 2 },
        ]
      : [
          { size: 512, q: 80 },
          { size: 512, q: 50 },
          { size: 320, q: 40 },
        ];
    let last;
    for (const [i, a] of attempts.entries()) {
      const out = path.join(dir, `out${i}.webp`);
      const geometry = crop
        ? `crop='min(iw,ih)':'min(iw,ih)',scale=${a.size}:${a.size}`
        : `scale=${a.size}:${a.size}:force_original_aspect_ratio=decrease,pad=${a.size}:${a.size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
      const vf = animated ? `${geometry},fps=${a.fps}` : `${geometry},format=rgba`;
      const args = [...SAFE_INPUT, "-i", input];
      if (animated) args.push("-t", String(a.t), "-an", "-loop", "0");
      else args.push("-frames:v", "1");
      args.push("-vf", vf, "-c:v", "libwebp", "-quality", String(a.q), "-compression_level", "6", "-pix_fmt", "yuva420p", out);
      await runFfmpeg(ffmpegPath, args);
      last = fs.readFileSync(out);
      if (last.length <= STICKER_MAX) break;
    }
    return addStickerExif(last, { pack, author, emojis });
  });
}

const AUDIO_FORMATS = {
  // WhatsApp music player
  mp3: { ext: "mp3", args: ["-c:a", "libmp3lame", "-q:a", "4"], mimetype: "audio/mpeg" },
  // WhatsApp voice note (push-to-talk): Opus in Ogg, mono, 48 kHz
  opus: { ext: "ogg", args: ["-c:a", "libopus", "-b:a", "48k", "-ac", "1", "-ar", "48000", "-application", "voip"], mimetype: "audio/ogg; codecs=opus" },
};

/**
 * Extracts/converts the audio of a video, voice note or audio file.
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
async function toAudio(buffer, { format = "mp3", ffmpegPath = "ffmpeg", tmpDir, maxSeconds = 1800, filter }) {
  const f = AUDIO_FORMATS[format];
  if (!f) throw new MediaError(`Unknown audio format ${format}`);
  return withTempDir(tmpDir, async (dir) => {
    const input = path.join(dir, "input");
    const out = path.join(dir, `out.${f.ext}`);
    fs.writeFileSync(input, buffer);
    // filter: an audio filter chain chosen by the bot (never user text), e.g. "atempo=1.25"
    const af = filter ? ["-af", filter] : [];
    await runFfmpeg(ffmpegPath, [...SAFE_INPUT, "-i", input, "-vn", "-map", "0:a:0", "-t", String(maxSeconds), ...af, ...f.args, out], { timeoutMs: 180000 });
    return { buffer: fs.readFileSync(out), mimetype: f.mimetype };
  });
}

/** Converts a WebP sticker (or any image) to PNG using sharp. */
async function toPng(buffer) {
  const sharp = require("sharp");
  return sharp(buffer, { animated: false, limitInputPixels: 64e6 }).png().toBuffer();
}

/** Guess a media kind from magic bytes. */
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return "unknown";
  const hex = buffer.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e47")) return "png";
  if (hex.startsWith("ffd8ff")) return "jpeg";
  if (hex.startsWith("47494638")) return "gif";
  if (hex.startsWith("52494646") && buffer.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buffer.subarray(4, 8).toString() === "ftyp") return "mp4";
  if (hex.startsWith("1a45dfa3")) return "webm";
  if (hex.startsWith("494433") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return "mp3";
  if (hex.startsWith("4f676753")) return "ogg";
  if (buffer.subarray(0, 64).toString("utf8").trimStart().startsWith("<")) return "html";
  return "unknown";
}

module.exports = {
  MediaError,
  unwrap,
  findMedia,
  downloadMedia,
  withTempDir,
  runFfmpeg,
  SAFE_INPUT,
  parseCodecs,
  probeCodecs,
  videoPlan,
  toWhatsAppVideo,
  toSticker,
  toAudio,
  addStickerExif,
  toPng,
  sniff,
  toNumber,
};
