"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");
const ytdlp = require("./ytdlp");

/**
 * Checks the external programs the bot uses and explains exactly what is wrong when one
 * is missing (used at startup, by `npm run check` and by the `.doctor` command).
 */

function runVersion(bin, args) {
  return new Promise((resolve) => {
    let out = "";
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    const timer = setTimeout(() => proc.kill("SIGKILL"), 15000);
    proc.stdout.on("data", (d) => (out.length < 4000 ? (out += d) : null));
    proc.stderr.on("data", (d) => (out.length < 4000 ? (out += d) : null));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: err.code, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: out.trim(), exitCode: code });
    });
  });
}

/** Why a program could not be started, in plain words. */
function explainFailure(bin, setting, result) {
  const isPath = /[\\/]/.test(bin);
  if (result.code === "ENOENT") {
    if (isPath && fs.existsSync(bin)) return `${bin} exists but could not be started (is it a ${process.platform} binary?).`;
    return isPath
      ? `${bin} does not exist. Check ${setting} in .env (use the full path, e.g. /home/<user>/.local/bin/yt-dlp).`
      : `"${bin}" was not found in PATH. Install it, or set ${setting} in .env to its full path.`;
  }
  if (result.code === "EACCES") return `${bin} is not executable. Run: chmod +x ${bin}`;
  if (result.error) return `${bin} could not be started: ${result.error}`;
  return `${bin} exited with code ${result.exitCode}: ${(result.output || "").split("\n").pop()}`;
}

async function probeTools(config) {
  const [ff, yt] = await Promise.all([runVersion(config.tools.ffmpeg, ["-version"]), runVersion(config.tools.ytdlp, ["--version"])]);
  const report = {
    ffmpeg: ff.ok
      ? { ok: true, path: config.tools.ffmpeg, version: (ff.output.match(/ffmpeg version (\S+)/) || [])[1] || "unknown" }
      : { ok: false, path: config.tools.ffmpeg, problem: explainFailure(config.tools.ffmpeg, "FFMPEG_PATH", ff) },
    ytdlp: yt.ok
      ? { ok: true, path: config.tools.ytdlp, version: yt.output.split("\n")[0] }
      : { ok: false, path: config.tools.ytdlp, problem: explainFailure(config.tools.ytdlp, "YTDLP_PATH", yt) },
    font: fs.existsSync(config.tools.fontFile)
      ? { ok: true, path: config.tools.fontFile }
      : { ok: false, path: config.tools.fontFile, problem: `Font ${config.tools.fontFile} not found. Install fonts-dejavu-core or set FONT_FILE.` },
  };
  if (report.ytdlp.ok) await ytdlp.isAvailable(config.tools.ytdlp); // also detects --js-runtimes support
  return report;
}

module.exports = { probeTools, explainFailure, runVersion };
