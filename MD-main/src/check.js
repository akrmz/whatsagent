"use strict";

/**
 * Dry run: validates configuration, loads every command and listener, prints the
 * generated help menu and which features are disabled — without connecting to WhatsApp.
 *
 *   npm run check            uses your .env
 *   npm run check -- --demo  uses a throwaway demo config (for CI / first look)
 */

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvFile, ConfigError } = require("./config");
const { createApp, detectCapabilities } = require("./main");
const { LoaderError } = require("./core/loader");
const { renderMenu } = require("./services/help");

async function main() {
  const demo = process.argv.includes("--demo");
  let env = process.env;
  if (demo) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "botcheck-"));
    env = { OWNER_NUMBERS: "15550000001", DATA_DIR: path.join(dir, "data"), SESSION_DIR: path.join(dir, "session"), TMP_DIR: path.join(dir, "tmp"), LOG_LEVEL: "warn", LOG_FORMAT: "json" };
  } else {
    loadEnvFile();
  }

  // Load with every capability on, so every module is validated.
  const allOn = new Proxy({}, { get: () => true, has: () => true });
  let app;
  try {
    app = await createApp({ env, capabilities: allOn });
  } catch (err) {
    if (err instanceof ConfigError || err instanceof LoaderError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  let problems = 0;
  try {
    require.resolve("link-preview-js");
    console.error("✗ link-preview-js is installed. Remove it: it makes Baileys fetch URLs from bot replies (SSRF).");
    problems++;
  } catch {
    console.log("✓ link-preview-js is not installed (no server-side link previews)");
  }

  const real = await detectCapabilities(app.config, app.ai);
  const missing = Object.entries(real).filter(([, ok]) => !ok).map(([k]) => k);
  const disabled = app.commands.list.filter((c) => c.requires.some((r) => !real[r])).map((c) => c.name);

  console.log(`✓ configuration valid`);
  console.log(`✓ ${app.commands.list.length} commands and ${[...app.listeners.byEvent.values()].flat().length} listeners loaded`);
  console.log(`  capabilities not available here: ${missing.join(", ") || "none"}`);
  console.log(`  commands that will be disabled at startup: ${disabled.join(", ") || "none"}`);
  console.log("\n----- generated .help -----\n");
  console.log(
    renderMenu({ commands: app.commands.list, prefix: app.config.bot.prefix, botName: app.config.bot.name, version: require("../package.json").version }),
  );
  app.state.flush();
  process.exitCode = problems ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
