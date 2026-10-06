"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Persistent bot state as small JSON files in DATA_DIR.
 *  - Reads happen once; the in-memory copy is the source of truth.
 *  - Writes are debounced and atomic (write temp file, then rename), so a crash can't
 *    leave a half-written file.
 *  - A corrupt file is moved aside and replaced by defaults, except the bot mode, which
 *    fails closed (private) so a corrupted file can never open the bot to everyone.
 */

const SAVE_DELAY_MS = 500;

function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

class JsonStore {
  constructor(file, defaults, log) {
    this.file = file;
    this.log = log;
    this.timer = null;
    this.data = this.load(defaults);
  }

  load(defaults) {
    const fresh = structuredClone(defaults);
    if (!fs.existsSync(this.file)) return fresh;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (Array.isArray(defaults)) return Array.isArray(parsed) ? parsed : fresh;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...fresh, ...parsed } : fresh;
    } catch (err) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, aside);
      } catch {
        /* best effort */
      }
      this.log?.warn({ file: this.file, movedTo: aside, err: err.message }, "state file was corrupt; using defaults");
      this.loadFailed = true;
      return fresh;
    }
  }

  /** Mutate the data with `fn(data)` and schedule a save. Returns fn's result. */
  update(fn) {
    const result = fn(this.data);
    this.scheduleSave();
    return result;
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      atomicWrite(this.file, this.data);
    } catch (err) {
      this.log?.error({ file: this.file, err: err.message }, "failed to save state");
    }
  }
}

function migrateLegacy(dataDir, log) {
  // Old bot kept the public/private mode inside messageCount.json next to message counters.
  const legacy = path.join(dataDir, "messageCount.json");
  if (fs.existsSync(legacy) && !fs.existsSync(path.join(dataDir, "mode.json"))) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, "utf8"));
      const { isPublic, messageCount: _unused, ...counts } = old;
      if (typeof isPublic === "boolean") atomicWrite(path.join(dataDir, "mode.json"), { isPublic });
      if (Object.keys(counts).length) atomicWrite(path.join(dataDir, "messageCounts.json"), counts);
      fs.renameSync(legacy, `${legacy}.migrated`);
      log?.info("migrated messageCount.json → mode.json + messageCounts.json");
    } catch (err) {
      log?.warn({ err: err.message }, "could not migrate messageCount.json; leaving it untouched");
    }
  }

  // Old bot had two warning counters (userGroupData.warnings for antilink/antibadword and
  // warnings.json for .warn). They are merged into warnings.json.
  const ugdFile = path.join(dataDir, "userGroupData.json");
  if (fs.existsSync(ugdFile)) {
    try {
      const ugd = JSON.parse(fs.readFileSync(ugdFile, "utf8"));
      if (ugd.warnings && Object.keys(ugd.warnings).length) {
        const wFile = path.join(dataDir, "warnings.json");
        const warnings = fs.existsSync(wFile) ? JSON.parse(fs.readFileSync(wFile, "utf8")) : {};
        for (const [chat, users] of Object.entries(ugd.warnings)) {
          warnings[chat] ||= {};
          for (const [user, n] of Object.entries(users)) warnings[chat][user] = (warnings[chat][user] || 0) + n;
        }
        atomicWrite(wFile, warnings);
        delete ugd.warnings;
        atomicWrite(ugdFile, ugd);
        log?.info("merged legacy antilink/antibadword warnings into warnings.json");
      }
    } catch (err) {
      log?.warn({ err: err.message }, "could not migrate userGroupData warnings");
    }
  }
}

function createState({ dataDir, defaultMode = "public", log }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  migrateLegacy(dataDir, log);
  const stores = new Map();

  function store(name, defaults = {}) {
    if (!stores.has(name)) stores.set(name, new JsonStore(path.join(dataDir, `${name}.json`), defaults, log));
    return stores.get(name);
  }

  const modeStore = store("mode", { isPublic: defaultMode === "public" });
  if (modeStore.loadFailed) modeStore.data.isPublic = false; // fail closed

  /** Names of the state files on disk (without .json), e.g. for backups. */
  function names() {
    stores.forEach((s) => s.flush());
    return fs
      .readdirSync(dataDir)
      .filter((f) => /^[A-Za-z0-9_-]+\.json$/.test(f))
      .map((f) => f.slice(0, -5))
      .sort();
  }

  /** Replaces a whole store (restore from a backup). Saved immediately. */
  function replace(name, data) {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(name)) throw new Error(`bad store name ${name}`);
    const s = store(name, Array.isArray(data) ? [] : {});
    s.data = structuredClone(data);
    s.flush();
  }

  return {
    store,
    names,
    replace,
    dataDir,
    isPublic: () => modeStore.data.isPublic === true,
    setPublic: (value) => modeStore.update((d) => (d.isPublic = Boolean(value))),
    flush: () => stores.forEach((s) => s.flush()),
  };
}

module.exports = { createState, JsonStore, atomicWrite };
