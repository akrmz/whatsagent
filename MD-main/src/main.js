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
const { createAi } = require("./services/ai");
const { probeTools } = require("./services/tools");
const { sudoList } = require("./services/settings");

const COMMANDS_DIR = path.join(__dirname, "commands");
const LISTENERS_DIR = path.join(__dirname, "listeners");

/**
 * Which optional features can run. Commands list what they need in `requires`.
 * Also returns a per-tool report (path, version or the exact problem) for logs and .doctor.
 */
async function detectCapabilities(config, ai) {
  const tools = await probeTools(config);
  const capabilities = {
    ffmpeg: tools.ffmpeg.ok,
    ytdlp: tools.ytdlp.ok,
    ai: Boolean(ai),
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

/** Builds the shared application object without connecting to WhatsApp. */
async function createApp({ env = process.env, capabilities: forced } = {}) {
  const config = buildConfig(env);
  const log = createLogger(config.log);
  const state = createState({ dataDir: config.paths.data, defaultMode: config.bot.defaultMode, log });
  const identity = new IdentityMap();
  const permissions = createPermissions({ owners: config.owners, identity, getSudoList: () => sudoList(state) });
  const ai = createAi(config, log);
  const capabilities = forced || (await detectCapabilities(config, ai));

  const app = {
    config,
    log,
    state,
    identity,
    permissions,
    ai,
    capabilities,
    groups: createGroupCache({ identity }),
    store: createMessageStore({ maxChats: config.limits.storeChats, perChat: config.limits.storePerChat }),
    sentIds: new LRU({ max: 5000, ttlMs: 10 * 60 * 1000 }),
    health: { state: "starting", startedAt: Date.now(), lastMessageAt: null },
    sock: null,
  };
  app.commands = loadCommands(COMMANDS_DIR, { capabilities, log });
  app.listeners = loadListeners(LISTENERS_DIR, { capabilities, log });
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
  app.connection = connection;

  let shuttingDown = false;
  function shutdown(signal, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
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

module.exports = { start, createApp, detectCapabilities, COMMANDS_DIR, LISTENERS_DIR };
