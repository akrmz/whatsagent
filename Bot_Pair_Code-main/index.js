import { buildConfig, loadEnvFile, ConfigError } from "./src/config.js";
import { createLogger } from "./src/logger.js";
import { createPairingManager } from "./src/pairing.js";
import { createApp } from "./src/server.js";

loadEnvFile();

let config;
try {
  config = buildConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\nCopy .env.example to .env and fill in the values. See docs/DEPLOYMENT.md.");
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel);
const pairing = createPairingManager({ config, logger });
const app = createApp({ config, logger, pairing });

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, delivery: config.delivery },
    "pairing service listening",
  );
});

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandled promise rejection");
});

function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
