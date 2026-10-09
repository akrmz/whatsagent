"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Auto-loads every .js file under src/commands and src/listeners.
 * Files whose name starts with "_" (like _template.js) are skipped.
 * A module may export one definition or an array of definitions.
 * Invalid metadata or duplicate names/aliases stop the bot at startup with a clear error.
 */

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PERMISSIONS = ["user", "groupAdmin", "sudo", "owner"];
const LISTENER_EVENTS = ["message", "command:after", "group-participants.update", "call", "status"];
const MESSAGE_PHASES = ["pre", "post"];

class LoaderError extends Error {}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

function definitionsIn(file) {
  const exported = require(file);
  return Array.isArray(exported) ? exported : [exported];
}

function validateRequires(def, capabilities, problems) {
  if (def.requires === undefined) return;
  if (!Array.isArray(def.requires)) return problems.push("requires must be an array");
  for (const r of def.requires) {
    if (!(r in capabilities)) problems.push(`requires: unknown capability "${r}" (known: ${Object.keys(capabilities).join(", ")})`);
  }
}

function validateCommand(def, capabilities) {
  const problems = [];
  if (!def || typeof def !== "object") return ["module must export a command object"];
  if (!NAME_RE.test(def.name || "")) problems.push(`name "${def.name}" must be lowercase letters, digits or dashes`);
  if (def.aliases !== undefined && (!Array.isArray(def.aliases) || def.aliases.some((a) => !NAME_RE.test(a)))) {
    problems.push("aliases must be an array of lowercase names");
  }
  if (typeof def.category !== "string" || !def.category) problems.push("category is required");
  if (typeof def.description !== "string" || !def.description) problems.push("description is required");
  if (def.usage !== undefined && typeof def.usage !== "string") problems.push("usage must be a string");
  if (!PERMISSIONS.includes(def.permission ?? "user")) problems.push(`permission must be one of ${PERMISSIONS.join(", ")}`);
  for (const flag of ["groupOnly", "privateOnly", "botAdmin", "hidden", "clientData"]) {
    if (def[flag] !== undefined && typeof def[flag] !== "boolean") problems.push(`${flag} must be true or false`);
  }
  if (def.groupOnly && def.privateOnly) problems.push("groupOnly and privateOnly cannot both be true");
  if (def.cooldown !== undefined && !(Number.isFinite(def.cooldown) && def.cooldown >= 0)) {
    problems.push("cooldown must be a number of seconds ≥ 0");
  }
  validateRequires(def, capabilities, problems);
  if (typeof def.run !== "function") problems.push("run(ctx) function is required");
  return problems;
}

function validateListener(def, capabilities) {
  const problems = [];
  if (!def || typeof def !== "object") return ["module must export a listener object"];
  if (!NAME_RE.test(def.name || "")) problems.push(`name "${def.name}" must be lowercase letters, digits or dashes`);
  if (!LISTENER_EVENTS.includes(def.event)) problems.push(`event must be one of ${LISTENER_EVENTS.join(", ")}`);
  if (def.event === "message" && !MESSAGE_PHASES.includes(def.phase)) problems.push('message listeners need phase "pre" or "post"');
  if (def.priority !== undefined && !Number.isFinite(def.priority)) problems.push("priority must be a number");
  validateRequires(def, capabilities, problems);
  if (typeof def.run !== "function") problems.push("run() function is required");
  return problems;
}

function missingRequirements(def, capabilities) {
  return (def.requires || []).filter((r) => !capabilities[r]);
}

/**
 * @returns {{ byName: Map, list: object[], disabled: Array<{name, missing}> }}
 */
function loadCommands(dirInput, { capabilities = {}, log } = {}) {
  const dir = path.resolve(dirInput);
  const byName = new Map();
  const list = [];
  const disabled = [];
  const owners = new Map(); // name/alias → file, for duplicate errors
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    for (const def of definitionsIn(file)) {
      const problems = validateCommand(def, capabilities);
      if (problems.length) throw new LoaderError(`Invalid command in ${rel}:\n  - ${problems.join("\n  - ")}`);
      for (const key of [def.name, ...(def.aliases || [])]) {
        if (owners.has(key)) {
          throw new LoaderError(`Command name or alias "${key}" in ${rel} is already used by ${owners.get(key)}`);
        }
        owners.set(key, rel);
      }
      const command = Object.freeze({
        aliases: [],
        usage: "",
        permission: "user",
        groupOnly: false,
        privateOnly: false,
        botAdmin: false,
        clientData: false,
        hidden: false,
        requires: [],
        ...def,
        file: rel,
      });
      const missing = missingRequirements(command, capabilities);
      if (missing.length) {
        disabled.push({ name: command.name, aliases: command.aliases, missing });
        log?.info({ command: command.name, missing }, "command disabled: requirement not configured");
        continue;
      }
      list.push(command);
      for (const key of [command.name, ...command.aliases]) byName.set(key, command);
    }
  }
  return { byName, list, disabled };
}

/** @returns {{ byEvent: Map<string, object[]>, disabled: Array }} */
function loadListeners(dirInput, { capabilities = {}, log } = {}) {
  const dir = path.resolve(dirInput);
  const byEvent = new Map();
  const names = new Set();
  const disabled = [];
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    for (const def of definitionsIn(file)) {
      const problems = validateListener(def, capabilities);
      if (problems.length) throw new LoaderError(`Invalid listener in ${rel}:\n  - ${problems.join("\n  - ")}`);
      if (names.has(def.name)) throw new LoaderError(`Listener name "${def.name}" in ${rel} is already used`);
      names.add(def.name);
      const missing = missingRequirements(def, capabilities);
      if (missing.length) {
        disabled.push({ name: def.name, missing });
        log?.info({ listener: def.name, missing }, "listener disabled: requirement not configured");
        continue;
      }
      const key = def.event === "message" ? `message:${def.phase}` : def.event;
      if (!byEvent.has(key)) byEvent.set(key, []);
      byEvent.get(key).push({ priority: 100, ...def, file: rel });
    }
  }
  for (const arr of byEvent.values()) arr.sort((a, b) => a.priority - b.priority);
  return { byEvent, disabled };
}

module.exports = { loadCommands, loadListeners, validateCommand, validateListener, LoaderError, PERMISSIONS };
