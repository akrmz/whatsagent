"use strict";

const path = require("node:path");
const pino = require("pino");
const { buildConfig, loadEnvFile, ConfigError } = require("./config");
const { createLogger } = require("./logger");
const { createState } = require("./core/state");
const { IdentityMap } = require("./core/identity");
const { createPermissions } = require("./core/permissions");
const { createGroupCache } = require("./core/groups");
const { createMessageStore } = require("./core/store");
const { LRU } = require("./core/lru");
const { loadCommands, loadListeners, LoaderError } = require("./core/loader");
const { createDispatcher } = require("./core/dispatcher");
const { createConnection } = require("./core/connection");
const { startHealthServer } = require("./core/health");
const { createAi, createMedia, mediaProviders } = require("./services/ai");
const { probeTools } = require("./services/tools");
const { sudoList } = require("./services/settings");
const { startReminderLoop } = require("./services/reminders");
const vars = require("./services/vars");
const jobs = require("./core/jobs");
const { startNoticeLoop } = require("./services/notices");
const { startAzkarLoop } = require("./services/azkar");
const { startAdhanLoop } = require("./services/adhan");
const { startAutoUpdate } = require("./services/autoupdate");
const { startGroupScheduleLoop } = require("./services/gcschedule");

const COMMANDS_DIR = path.join(__dirname, "commands");
const LISTENERS_DIR = path.join(__dirname, "listeners");

/**
 * Which optional features can run. Commands list what they need in `requires`.
 * Also returns a per-tool report (path, version or the exact problem) for logs and .doctor.
 */
async function detectCapabilities(config, ai, { tools: known } = {}) {
  const tools = known || (await probeTools(config));
  const capabilities = {
    ffmpeg: tools.ffmpeg.ok,
    ytdlp: tools.ytdlp.ok,
    ai: Boolean(ai),
    aiImage: mediaProviders(config).length > 0, // .imagine (Gemini or OpenAI key)
    aiAudio: mediaProviders(config).length > 0, // .transcribe
    font: tools.font.ok,
    newsApi: Boolean(config.keys.newsApi),
    openWeather: Boolean(config.keys.openWeather),
    tenor: Boolean(config.keys.tenor),
    telegramBot: Boolean(config.keys.telegramBot),
    removeBg: Boolean(config.keys.removeBg),
    remini: Boolean(config.keys.remini),
    githubRepo: Boolean(config.githubRepo),
  };
  Object.defineProperty(capabilities, "tools", { value: tools, enumerable: false });
  return capabilities;
}

/**
 * Lets settings change at runtime (.setvar, .setai …): app.reconfigure(next) validates the
 * complete new overrides, saves them, and rebuilds the config, the AI client, the tool
 * check and the command/listener lists. Nothing is saved if validation fails.
 * Also used by the tests, so they exercise the same code.
 */
function enableRuntimeSettings(app, { baseEnv, overrides = {}, forcedCapabilities = null }) {
  app.baseEnv = baseEnv;
  app.overrides = overrides;
  /** @returns {Promise<{ enabled: string[], disabled: string[] }>} commands that changed state */
  app.reconfigure = async (next) => {
    const nextConfig = buildConfig({ ...app.baseEnv, ...next }); // throws ConfigError
    vars.save(app.config.paths.data, next);
    const before = new Set(app.commands.list.map((c) => c.name));
    app.overrides = next;
    app.ai = createAi(nextConfig, app.log);
    app.media = createMedia(nextConfig, app.log);
    // Re-check the programs only when one of their paths changed (it takes a few seconds).
    const t = (c) => [c.tools.ffmpeg, c.tools.ytdlp, c.tools.fontFile].join("|");
    const sameTools = t(nextConfig) === t(app.config) && app.capabilities.tools;
    const previousTools = sameTools ? app.capabilities.tools : undefined;
    app.capabilities = forcedCapabilities || (await detectCapabilities(nextConfig, app.ai, { tools: previousTools }));
    app.config = nextConfig;
    jobs.setLimit(nextConfig.limits.parallelJobs);
    app.commands = loadCommands(COMMANDS_DIR, { capabilities: app.capabilities, log: app.log });
    app.listeners = loadListeners(LISTENERS_DIR, { capabilities: app.capabilities, log: app.log });
    const after = new Set(app.commands.list.map((c) => c.name));
    return { enabled: [...after].filter((n) => !before.has(n)), disabled: [...before].filter((n) => !after.has(n)) };
  };
  return app;
}

/** Builds the shared application object without connecting to WhatsApp. */
async function createApp({ env = process.env, capabilities: forced } = {}) {
  // Settings saved from WhatsApp (.setvar …) override .env. If they no longer validate
  // (e.g. after an upgrade), start with .env alone rather than not at all.
  const baseEnv = { ...env };
  let overrides = vars.load(vars.dataDirOf(baseEnv));
  let config;
  let ignored = null;
  try {
    config = buildConfig({ ...baseEnv, ...overrides });
  } catch (err) {
    if (!(err instanceof ConfigError) || !Object.keys(overrides).length) throw err;
    config = buildConfig(baseEnv);
    ignored = err.problems;
    overrides = {};
  }
  const log = createLogger(config.log);
  jobs.setLimit(config.limits.parallelJobs);
  if (ignored) log.error({ problems: ignored }, "settings saved from chat are invalid and were ignored; fix them with .setvar/.delvar");
  const state = createState({ dataDir: config.paths.data, defaultMode: config.bot.defaultMode, log });
  const identity = new IdentityMap();
  const permissions = createPermissions({ owners: config.owners, identity, getSudoList: () => sudoList(state) });
  const ai = createAi(config, log);
  const media = createMedia(config, log);
  const capabilities = forced || (await detectCapabilities(config, ai));

  const app = {
    config,
    log,
    state,
    identity,
    permissions,
    ai,
    media,
    capabilities,
    groups: createGroupCache({ identity }),
    store: createMessageStore({ maxChats: config.limits.storeChats, perChat: config.limits.storePerChat }),
    sentIds: new LRU({ max: 5000, ttlMs: 10 * 60 * 1000 }),
    health: { state: "starting", startedAt: Date.now(), lastMessageAt: null },
    sock: null,
  };
  app.commands = loadCommands(COMMANDS_DIR, { capabilities, log });
  app.listeners = loadListeners(LISTENERS_DIR, { capabilities, log });
  enableRuntimeSettings(app, { baseEnv, overrides, forcedCapabilities: forced });
  return app;
}

async function start() {
  loadEnvFile();
  let app;
  try {
    app = await createApp();
  } catch (err) {
    if (err instanceof ConfigError || err instanceof LoaderError) {
      console.error(`\n${err.message}\n`);
      if (err instanceof ConfigError) console.error("Copy .env.example to .env and fill it in. See docs/DEPLOYMENT.md.\n");
      process.exit(1);
    }
    throw err;
  }
  const { config, log } = app;
  log.info(
    { commands: app.commands.list.length, disabled: app.commands.disabled.map((d) => d.name), capabilities: app.capabilities },
    `${config.bot.name} starting`,
  );
  for (const [name, t] of Object.entries(app.capabilities.tools || {})) {
    if (t.ok) log.info({ tool: name, path: t.path, version: t.version }, "tool found");
    else log.warn({ tool: name }, `${name} unavailable: ${t.problem}`);
  }

  const baileysLogger = pino({ level: config.log.baileysLevel });
  const dispatcher = createDispatcher(app);
  const connection = createConnection(app, dispatcher, baileysLogger);
  const health = startHealthServer(app);
  const stopReminders = startReminderLoop(app);
  const stopAutoUpdate = startAutoUpdate(app);
  const stopGroupSchedule = startGroupScheduleLoop(app);
  const stopAzkar = startAzkarLoop(app);
  const stopAdhan = startAdhanLoop(app);
  const stopNotices = startNoticeLoop(app, require("../package.json").version);
  app.connection = connection;

  let shuttingDown = false;
  function shutdown(signal, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
    stopReminders();
    stopAutoUpdate();
    stopGroupSchedule();
    stopNotices();
    stopAzkar();
    stopAdhan();
    connection.stop();
    app.state.flush();
    health?.close();
    setTimeout(() => process.exit(code), 1500).unref();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (err) => log.error({ err }, "unhandled promise rejection"));
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaught exception; exiting so the process manager restarts the bot");
    shutdown("uncaughtException", 1);
  });

  await connection.start();
}

module.exports = { start, createApp, enableRuntimeSettings, detectCapabilities, COMMANDS_DIR, LISTENERS_DIR };
