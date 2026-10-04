"use strict";

// Entry point. Everything lives in src/; see docs/ARCHITECTURE.md and docs/ADDING_FEATURES.md.

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js 22.12 or newer is required (you have ${process.versions.node}). See docs/DEPLOYMENT.md.`);
  process.exit(1);
}

require("./src/main")
  .start()
  .catch((err) => {
    console.error("Fatal startup error:", err);
    process.exit(1);
  });
