"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { withTempDir, probeCodecs, videoPlan, toWhatsAppVideo } = require("../core/media");
const { UserError } = require("../core/errors");
const { LRU } = require("../core/lru");
const { heavy } = require("../core/jobs");
const { HOSTS, AUDIO_SITES, hostIn } = require("./sites");
const cookies = require("./cookies");
const sharelinks = require("./sharelinks");

/**
 * Downloads media with yt-dlp (https://github.com/yt-dlp/yt-dlp), run without a shell.
 * Used by .song/.video/.tiktok/.fb/.instagram. Hard limits: file size, duration, time.
 * The "generic" extractor is disabled so yt-dlp only talks to sites it explicitly supports.
 */

function firstUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let url;
  try {
    url = new URL(m[0]);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  return url;
}

/** Returns the URL if it is https/http and its host belongs to `site`, else null. */
function matchSiteUrl(text, site) {
  const url = firstUrl(text);
  return url && hostIn(url.hostname.toLowerCase(), site) ? url.toString() : null;
}

/** Finds the first link in the text on any supported site. @returns {{ site, url } | null} */
function detectSite(text) {
  const url = firstUrl(text);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const site = Object.keys(HOSTS).find((s) => hostIn(host, s));
  return site ? { site, url: url.toString() } : null;
}

/** Runs yt-dlp through the shared job limit (core/jobs). */
const run = (bin, args, timeoutMs) => heavy(() => runNow(bin, args, timeoutMs));

function runNow(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Force UTF-8 so non-Latin titles (Arabic, emoji …) survive on every OS, and decode
    // the stream as UTF-8 so characters split across chunks are not corrupted.
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    let out = "";
    let err = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (d) => (out.length < 100000 ? (out += d) : null));
    proc.stderr.on("data", (d) => (err.length < 8000 ? (err += d) : null));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new UserError("yt-dlp is not installed on the server.") : e);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new UserError("The download took too long and was stopped."));
      resolve({ code, out, err });
    });
  });
}

// Newer yt-dlp releases need a JavaScript runtime for YouTube; Node is always present here.
let supportsJsRuntimes = false;

async function isAvailable(bin) {
  try {
    const { code } = await run(bin, ["--version"], 15000);
    if (code !== 0) return false;
    const help = await run(bin, ["--help"], 15000);
    supportsJsRuntimes = help.out.includes("--js-runtimes");
    return true;
  } catch {
    return false;
  }
}

function explain(stderr) {
  if (/File is larger than max-filesize/i.test(stderr)) return "The file is larger than the allowed limit.";
  if (/does not pass filter/i.test(stderr)) return "The media is longer than the allowed duration.";
  if (/login|private|cookies|sign in/i.test(stderr)) return "This content is private or needs a login.";
  if (/Unsupported URL|No video formats|no suitable|not available/i.test(stderr)) return "No downloadable media was found at that link.";
  return "Download failed. The link may be invalid or the site may be blocking downloads.";
}

/**
 * @param {object} config  bot config
 * @param {object} opts
 * @param {string} opts.target  URL, or a search query when opts.search is true
 * @param {'audio'|'video'} opts.kind
 * @param {boolean} [opts.search]  search YouTube for the query instead of using a URL
 * @param {number} [opts.maxItems] allow up to N items from a post/carousel (default 1)
 * @param {boolean} [opts.hasFfmpeg] ffmpeg available (needed for audio and for merging video+audio)
 * @returns {Promise<Array<{ buffer: Buffer, title: string, ext: string }>>}
 */
async function download(config, { target, kind, search = false, maxItems = 1, hasFfmpeg = true }) {
  if (kind === "audio" && !hasFfmpeg) throw new UserError("ffmpeg is not installed on the server, so audio can't be extracted.");
  const maxBytes = config.limits.downloadBytes;
  // Facebook "Share" links (facebook.com/share/r/…) → the real post, which yt-dlp can open.
  if (!search) target = await sharelinks.resolve(target);
  return withTempDir(config.paths.tmp, async (dir) => {
    const args = [
      "--ignore-config",
      "--no-cache-dir",
      "--no-warnings",
      "--no-progress",
      "--restrict-filenames",
      "--use-extractors",
      "all,-generic",
      "--max-filesize",
      String(maxBytes),
      "--match-filter",
      // "<=?" also accepts items without a known duration (e.g. some TikTok/Instagram posts)
      `duration<=?${config.limits.videoSeconds}`,
      "--socket-timeout",
      "30",
      "-o",
      path.join(dir, "%(autonumber)s.%(ext)s"),
      "--print",
      "after_move:%(title)s",
    ];
    if (maxItems > 1) args.push("--yes-playlist", "--playlist-items", `1:${maxItems}`);
    else args.push("--no-playlist");
    if (config.tools.ffmpeg !== "ffmpeg") args.push("--ffmpeg-location", config.tools.ffmpeg);
    args.push(...cookies.ytdlpArgs(config, search ? "youtube" : detectSite(target)?.site));
    if (supportsJsRuntimes) args.push("--js-runtimes", "node");
    if (kind === "audio") {
      args.push("-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5");
    } else {
      args.push("-f", hasFfmpeg ? VIDEO_FORMAT : VIDEO_FORMAT_NO_FFMPEG);
      if (hasFfmpeg) args.push("--merge-output-format", "mp4");
    }
    args.push("--", search ? `ytsearch1:${target}` : target);

    const { code, out, err } = await run(config.tools.ytdlp, args, 5 * 60 * 1000);
    const files = fs
      .readdirSync(dir)
      .filter((f) => !f.endsWith(".part") && !f.endsWith(".ytdl"))
      .sort();
    if (code !== 0 && files.length === 0) throw new UserError(explain(err));
    if (files.length === 0) throw new UserError("No downloadable media was found.");
    const titles = out.trim().split("\n");
    const items = [];
    for (const [i, f] of files.slice(0, maxItems).entries()) {
      let file = path.join(dir, f);
      let ext = path.extname(f).slice(1).toLowerCase();
      if (kind === "video" && hasFfmpeg && VIDEO_EXTS.has(ext)) {
        const fixed = await playableOnWhatsApp(config, file, ext);
        if (fixed) [file, ext] = [fixed, "mp4"];
      }
      if (fs.statSync(file).size > maxBytes) throw new UserError("The file is larger than the allowed limit.");
      items.push({ buffer: fs.readFileSync(file), title: titles[i] || "media", ext });
    }
    return items;
  });
}

/*
 * Video formats, best first. WhatsApp plays H.264 video with AAC audio on every phone, but
 * sites increasingly serve AV1 or VP9 (Facebook's separate video streams are all AV1), which
 * WhatsApp shows as "something is wrong with the video file". So: a ready-made H.264 MP4,
 * then H.264 video + AAC audio, then any ready-made MP4 (Facebook's "hd"/"sd" files, whose
 * codec isn't listed but is H.264), and only then anything — converted after the download.
 */
const VIDEO_FORMAT = [
  "b[ext=mp4][vcodec^=avc][height<=?720]",
  "bv*[vcodec^=avc][height<=?720]+ba[acodec^=mp4a]",
  "bv*[vcodec^=avc][height<=?720]+ba",
  "b[ext=mp4][height<=?720]",
  "bv*[height<=?720]+ba",
  "b",
].join("/");
// Without ffmpeg only ready-made (single-file) formats can be used, and nothing can be converted.
const VIDEO_FORMAT_NO_FFMPEG = ["b[ext=mp4][vcodec^=avc][height<=?720]", "b[ext=mp4][height<=?720]", "b[height<=?720]", "b"].join("/");
const VIDEO_EXTS = new Set(["mp4", "webm", "mkv", "mov", "m4v"]);

/**
 * Checks the codecs of a downloaded video and converts it if WhatsApp can't play it.
 * @returns {Promise<string|null>} the converted file, or null if the original is fine
 */
async function playableOnWhatsApp(config, file, ext) {
  const codecs = await probeCodecs(config.tools.ffmpeg, file);
  const plan = videoPlan(codecs, ext);
  if (plan === "ok") return null;
  const out = `${file}.whatsapp.mp4`;
  try {
    await toWhatsAppVideo(config.tools.ffmpeg, file, out, { plan, codecs, maxSeconds: config.limits.videoSeconds });
  } catch {
    throw new UserError("The video uses a format WhatsApp can't play, and converting it failed.");
  }
  return out;
}

/**
 * Searches YouTube without downloading anything.
 * @returns {Promise<Array<{ id, url, title, seconds, channel, views }>>}
 */
async function search(config, query, count = 5) {
  const n = Math.min(10, Math.max(1, count));
  const args = [
    "--ignore-config",
    "--no-cache-dir",
    "--no-warnings",
    "--flat-playlist",
    "--use-extractors",
    "all,-generic",
    "--socket-timeout",
    "20",
    "--print",
    "%(id)s\t%(duration)s\t%(channel,uploader)s\t%(view_count)s\t%(title)s",
  ];
  args.push(...cookies.ytdlpArgs(config, "youtube"));
  args.push("--", `ytsearch${n}:${String(query).slice(0, 200)}`);
  const { code, out, err } = await run(config.tools.ytdlp, args, 60 * 1000);
  if (code !== 0 && !out.trim()) throw new UserError(explain(err));
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((f) => f.length >= 5 && /^[\w-]{6,20}$/.test(f[0]))
    .map(([id, duration, channel, views, ...title]) => ({
      id,
      url: `https://youtu.be/${id}`,
      title: title.join("\t"),
      seconds: Number(duration) || 0,
      channel: channel === "NA" ? "" : channel,
      views: Number(views) || 0,
    }));
}

/** WebVTT → plain text: no header, timings or tags, and without the repeated lines of auto-captions. */
function vttToText(vtt) {
  const out = [];
  for (const raw of String(vtt).split(/\r?\n/)) {
    const line = raw.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ").trim();
    if (!line || /^(WEBVTT|Kind:|Language:|NOTE\b)/.test(line) || /-->/.test(line) || /^\d+$/.test(line)) continue;
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Gets the transcript of a video from its subtitles (no video download).
 * Asks for the original-language auto captions and English only: requesting many
 * languages makes YouTube answer "429 Too Many Requests".
 * @returns {Promise<{ title: string, text: string }>}
 */
async function transcript(config, url) {
  return withTempDir(config.paths.tmp, async (dir) => {
    const args = [
      "--ignore-config",
      "--no-cache-dir",
      "--no-warnings",
      "--use-extractors",
      "all,-generic",
      "--skip-download",
      "--no-playlist",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      ".*-orig,en,ar",
      "--sub-format",
      "vtt/best",
      "--convert-subs",
      "vtt",
      "--socket-timeout",
      "30",
      "-o",
      path.join(dir, "s.%(ext)s"),
      "--print",
      "%(title)s",
      "--no-simulate",
      ...cookies.ytdlpArgs(config, detectSite(url)?.site),
    ];
    if (supportsJsRuntimes) args.push("--js-runtimes", "node");
    args.push("--", url);
    const { out, err } = await run(config.tools.ytdlp, args, 2 * 60 * 1000);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".vtt"));
    // Original-language captions first, then manual English, then anything.
    const pick = files.find((f) => /-orig\.vtt$/.test(f)) || files.find((f) => /^s\.en\.vtt$/.test(f)) || files[0];
    if (!pick) {
      if (/429|Too Many Requests/i.test(err)) throw new UserError("YouTube is limiting requests right now. Try again in a few minutes.");
      throw new UserError(files.length ? "Could not read the subtitles." : "This video has no subtitles or captions to read.");
    }
    return { title: out.trim().split("\n")[0] || "video", text: vttToText(fs.readFileSync(path.join(dir, pick), "utf8")) };
  });
}

// The last .yts results per chat+user, so ".play 2" / ".video 2" can pick one.
const lastSearch = new LRU({ max: 2000, ttlMs: 30 * 60 * 1000 });
const rememberSearch = (ctx, results) => lastSearch.set(`${ctx.chatId}|${ctx.sender}`, results);
/** Returns the URL of result #n from this user's last search in this chat, or null. */
function recallSearch(ctx, n) {
  const results = lastSearch.get(`${ctx.chatId}|${ctx.sender}`);
  return results?.[n - 1]?.url || null;
}

module.exports = { download, search, transcript, vttToText, isAvailable, matchSiteUrl, detectSite, rememberSearch, recallSearch, HOSTS, AUDIO_SITES, VIDEO_FORMAT, VIDEO_FORMAT_NO_FFMPEG };
