"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { withTempDir } = require("../core/media");
const { UserError } = require("../core/errors");

/**
 * Downloads media with yt-dlp (https://github.com/yt-dlp/yt-dlp), run without a shell.
 * Used by .song/.video/.tiktok/.fb/.instagram. Hard limits: file size, duration, time.
 * The "generic" extractor is disabled so yt-dlp only talks to sites it explicitly supports.
 */

const HOSTS = {
  youtube: ["youtube.com", "youtu.be", "music.youtube.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  instagram: ["instagram.com", "instagr.am"],
};

/** Returns the URL if it is https/http and its host belongs to `site`, else null. */
function matchSiteUrl(text, site) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let url;
  try {
    url = new URL(m[0]);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const ok = HOSTS[site].some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? url.toString() : null;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
 * @returns {Promise<Array<{ buffer: Buffer, title: string, ext: string }>>}
 */
async function download(config, { target, kind, search = false, maxItems = 1 }) {
  const maxBytes = config.limits.downloadBytes;
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
    if (config.tools.ytdlpCookies) args.push("--cookies", config.tools.ytdlpCookies);
    if (supportsJsRuntimes) args.push("--js-runtimes", "node");
    if (kind === "audio") {
      args.push("-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5");
    } else {
      args.push("-f", "b[ext=mp4][height<=720]/bv*[height<=720]+ba/b", "--merge-output-format", "mp4");
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
    return files.slice(0, maxItems).map((f, i) => {
      const file = path.join(dir, f);
      if (fs.statSync(file).size > maxBytes) throw new UserError("The file is larger than the allowed limit.");
      return { buffer: fs.readFileSync(file), title: titles[i] || "media", ext: path.extname(f).slice(1) };
    });
  });
}

module.exports = { download, isAvailable, matchSiteUrl, HOSTS };
