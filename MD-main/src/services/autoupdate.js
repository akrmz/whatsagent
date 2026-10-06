"use strict";

const { createUpdater } = require("./updater");

/**
 * YTDLP_AUTO_UPDATE=true: once a day, update yt-dlp to the latest nightly (sites like
 * YouTube change often and old versions stop working). Only yt-dlp is updated
 * automatically, never the bot's own code (that stays a deliberate ".update now").
 * The last result is kept in app.health.ytdlpAutoUpdate for .doctor.
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

async function tick(app, now = Date.now(), make = createUpdater) {
  const last = app.health.ytdlpAutoUpdate;
  if (!app.config.tools.ytdlpAutoUpdate || !app.capabilities.ytdlp) return null;
  if (last && now - last.at < UPDATE_EVERY_MS) return null;
  const updater = make({ config: app.config, log: app.log });
  let result;
  try {
    const status = await updater.ytdlpStatus();
    if (!status.installed) result = { ok: false, message: "yt-dlp not found" };
    else if (!status.behind) result = { ok: true, message: `already latest (${status.current})` };
    else result = { ok: true, message: `updated ${status.current} → ${await updater.updateYtdlp()}` };
  } catch (err) {
    result = { ok: false, message: err.message };
  }
  app.health.ytdlpAutoUpdate = { at: now, ...result };
  app.log[result.ok ? "info" : "warn"]({ result: result.message }, "yt-dlp auto-update");
  return app.health.ytdlpAutoUpdate;
}

function startAutoUpdate(app) {
  // First check a few minutes after startup, then hourly (it acts at most once a day).
  const first = setTimeout(() => tick(app).catch(() => {}), 5 * 60 * 1000);
  const timer = setInterval(() => tick(app).catch(() => {}), CHECK_EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { startAutoUpdate, tick };
