"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getJson } = require("../core/http");

/**
 * Self-update for the owner's `.update` command.
 *
 * Bot code: only from the git remote/branch in config (UPDATE_REMOTE / UPDATE_BRANCH),
 * only fast-forward, never with local changes, validated with `src/check.js` before the
 * restart, and rolled back automatically if validation fails. No URLs or arguments are
 * accepted from chat. Everything runs with spawn (no shell).
 *
 * yt-dlp: compares `yt-dlp --version` with the latest nightly release on GitHub and runs
 * `yt-dlp --update-to nightly` (works for the standalone yt-dlp binary).
 */

const BOT_DIR = path.resolve(__dirname, "..", "..");
const SAFE_REF = /^(?!-)[A-Za-z0-9._/-]{1,100}$/;
const NIGHTLY_API = "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";

class UpdateError extends Error {}

/** Runs a program without a shell. Resolves { code, stdout, stderr }. */
function runProcess(cmd, args, { cwd = BOT_DIR, timeoutMs = 120000, env } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      // npm is a .cmd file on Windows and needs a shell there; arguments are fixed strings.
      const shell = process.platform === "win32" && cmd === "npm";
      proc = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: err.message });
      return;
    }
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (d) => (stdout.length < 200000 ? (stdout += d) : null));
    proc.stderr.on("data", (d) => (stderr.length < 20000 ? (stderr += d) : null));
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.code === "ENOENT" ? `${cmd} is not installed` : err.message });
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? -1 : code, stdout, stderr: signal ? `${cmd} timed out` : stderr });
    });
  });
}

function readVersion(json) {
  try {
    return JSON.parse(json).version || "?";
  } catch {
    return "?";
  }
}

function createUpdater({ config, log, run = runProcess, fetchJson = getJson }) {
  const remote = config.update.remote;
  const branch = config.update.branch;
  const target = `${remote}/${branch}`;
  let busy = false;

  async function git(args, opts) {
    const res = await run("git", args, { cwd: BOT_DIR, timeoutMs: 120000, ...opts });
    if (res.code !== 0) throw new UpdateError(`git ${args[0]} failed: ${(res.stderr || res.stdout).trim().split("\n").pop()}`);
    return res.stdout.trim();
  }

  /** Bot status: is this a git checkout, and how far behind the configured branch is it? */
  async function botStatus() {
    if (!SAFE_REF.test(remote) || !SAFE_REF.test(branch)) {
      return { supported: false, reason: "UPDATE_REMOTE / UPDATE_BRANCH contain invalid characters." };
    }
    const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd: BOT_DIR, timeoutMs: 15000 });
    if (top.code !== 0) {
      return {
        supported: false,
        reason:
          "This installation is not a git clone (for example a Docker image), so it can't update itself. " +
          "Update on the server instead (see docs/DEPLOYMENT.md §8).",
      };
    }
    await git(["fetch", "--quiet", remote, branch]);
    const current = await git(["rev-parse", "HEAD"]);
    const latest = await git(["rev-parse", target]);
    const [ahead, behind] = (await git(["rev-list", "--left-right", "--count", `HEAD...${target}`])).split(/\s+/).map(Number);
    const dirty = (await git(["status", "--porcelain", "--untracked-files=no"])) !== "";
    const currentVersion = readVersion(fs.readFileSync(path.join(BOT_DIR, "package.json"), "utf8"));
    const latestVersion = readVersion(await git(["show", `${target}:MD-main/package.json`]).catch(() => "{}"));
    const changes = behind ? (await git(["log", "--format=%h %s", "-n", "5", `HEAD..${target}`])).split("\n").filter(Boolean) : [];
    return { supported: true, current, latest, currentVersion, latestVersion, ahead, behind, dirty, changes };
  }

  async function ytdlpStatus() {
    const res = await run(config.tools.ytdlp, ["--version"], { timeoutMs: 20000 });
    if (res.code !== 0) return { installed: false };
    const current = res.stdout.trim();
    let latest = null;
    try {
      latest = (await fetchJson(NIGHTLY_API, { headers: { "user-agent": "whatsapp-bot-updater", accept: "application/vnd.github+json" } })).tag_name;
    } catch (err) {
      log.warn({ err: err.message }, "could not check the latest yt-dlp nightly");
    }
    return { installed: true, current, latest, behind: Boolean(latest && latest !== current) };
  }

  async function updateYtdlp() {
    const res = await run(config.tools.ytdlp, ["--update-to", "nightly"], { timeoutMs: 180000 });
    const output = `${res.stdout}\n${res.stderr}`;
    if (res.code !== 0 || /pip|cannot update|not writable|permission denied/i.test(output)) {
      throw new UpdateError(
        "yt-dlp could not update itself. Install the standalone nightly binary in a folder the bot can write to (docs/DEPLOYMENT.md §5.1).",
      );
    }
    const after = await run(config.tools.ytdlp, ["--version"], { timeoutMs: 20000 });
    return after.stdout.trim();
  }

  /** Fast-forwards to the remote branch, installs dependencies if needed, validates, rolls back on failure. */
  async function updateBot(status) {
    if (status.dirty) throw new UpdateError("The server has local code changes. Commit or remove them first; nothing was changed.");
    if (status.ahead) throw new UpdateError(`This server has ${status.ahead} commit(s) that are not on ${target}; refusing to overwrite them.`);
    const from = status.current;
    await git(["merge", "--ff-only", "--quiet", status.latest]);
    const changed = (await git(["diff", "--name-only", from, status.latest])).split("\n");
    const depsChanged = changed.some((f) => /^MD-main\/package(-lock)?\.json$/.test(f));

    const rollback = async (why) => {
      log.error({ why }, "update failed validation; rolling back");
      await git(["reset", "--hard", "--quiet", from]);
      if (depsChanged) await run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: BOT_DIR, timeoutMs: 600000 });
      throw new UpdateError(`The new version failed validation and was rolled back: ${why}`);
    };

    if (depsChanged) {
      const npm = await run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: BOT_DIR, timeoutMs: 600000 });
      if (npm.code !== 0) await rollback(`npm ci failed (${npm.stderr.trim().split("\n").pop()})`);
    }
    const check = await run(process.execPath, ["src/check.js"], { cwd: BOT_DIR, timeoutMs: 120000 });
    if (check.code !== 0) await rollback((check.stderr || check.stdout).trim().split("\n").slice(0, 3).join(" ") || "check failed");
    return { from, to: status.latest, depsChanged };
  }

  /** Runs `fn` unless another update is in progress. */
  async function exclusive(fn) {
    if (busy) throw new UpdateError("An update is already running.");
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  }

  return { botStatus, ytdlpStatus, updateBot, updateYtdlp, exclusive, target, UpdateError };
}

module.exports = { createUpdater, runProcess, UpdateError, BOT_DIR };
