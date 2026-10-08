"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadCommands } = require("../src/core/loader");
const { COMMANDS_DIR } = require("../src/main");

const DOCS = path.join(__dirname, "..", "..", "docs");
// Names in `backticks` that start with a dot but are files or formats, not commands.
const NOT_COMMANDS = new Set(["env", "csv", "json", "xlsx", "ics", "tar", "gz", "jpg", "jpeg", "png", "webp", "mp4", "mp3", "pdf", "txt", "md", "js", "docx", "zip", "vcf", "ogg", "opus", "gitignore", "npmrc", "nvmrc", "dockerignore"]);

/** Every ".command" written in `backticks` in a doc. */
function commandsIn(file) {
  const text = fs.readFileSync(path.join(DOCS, file), "utf8");
  const found = new Set();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const m = span[1].match(/^\.([a-z][a-z0-9-]*)/i);
    if (m && !NOT_COMMANDS.has(m[1].toLowerCase())) found.add(m[1].toLowerCase());
  }
  return found;
}

// Skipped where only MD-main is present (e.g. a copied folder without the repository's docs/).
test("every command the user guides mention exists (name or alias)", { skip: !fs.existsSync(path.join(DOCS, "USAGE.md")) && "docs/ not present" }, () => {
  const allOn = new Proxy({}, { get: () => true, has: () => true });
  const { byName, list } = loadCommands(COMMANDS_DIR, { capabilities: allOn });
  for (const file of ["REAL_ESTATE_AR.md", "USAGE.md"]) {
    const missing = [...commandsIn(file)].filter((c) => !byName.has(c));
    assert.deepEqual(missing, [], `${file} mentions commands that don't exist`);
  }
  // And the Arabic guide covers every real-estate command (a new one must be documented there too).
  const guide = commandsIn("REAL_ESTATE_AR.md");
  const undocumented = list.filter((c) => c.category === "realestate" && ![c.name, ...(c.aliases || [])].some((n) => guide.has(n))).map((c) => c.name);
  assert.deepEqual(undocumented, [], "real-estate commands missing from docs/REAL_ESTATE_AR.md");
});
