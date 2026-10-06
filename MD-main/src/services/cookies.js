"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UserError } = require("../core/errors");
const { HOSTS, LOGIN_COOKIES, COOKIE_DOMAINS } = require("./sites");

/**
 * Per-site login cookies for yt-dlp, set from WhatsApp with .setcookie.
 *
 * Stored as DATA_DIR/cookies/<site>.txt (Netscape format, mode 600). Accepted input:
 *   - cookies.txt (Netscape format, e.g. the "Get cookies.txt LOCALLY" browser extension)
 *   - JSON array (Cookie-Editor / EditThisCookie export)
 *   - a header string "name=value; name2=value2" (Cookie-Editor "Header String")
 * Only cookies for the chosen site's own domains are kept; everything else is dropped,
 * so pasting a full browser export never stores logins for unrelated sites.
 * Cookie values are never logged or shown.
 */

const MAX_INPUT = 1024 * 1024;
const MAX_COOKIES = 3000;
const HEADER = "# Netscape HTTP Cookie File\n# Saved by the bot (.setcookie). Treat this file like a password.\n";

const dirOf = (config) => path.join(config.paths.data, "cookies");
const fileFor = (config, site) => path.join(dirOf(config), `${site}.txt`);

/** yt-dlp arguments for a download from `site`: its own cookies, else YTDLP_COOKIES, else none. */
function ytdlpArgs(config, site) {
  if (site && Object.hasOwn(HOSTS, site)) {
    const file = fileFor(config, site);
    if (fs.existsSync(file)) return ["--cookies", file];
  }
  return config.tools.ytdlpCookies ? ["--cookies", config.tools.ytdlpCookies] : [];
}

const clean = (v) => String(v ?? "").replace(/[\t\r\n]/g, "");
const domainOk = (domain, site) => {
  const d = String(domain || "").toLowerCase().replace(/^\./, "");
  return COOKIE_DOMAINS[site].some((h) => d === h || d.endsWith(`.${h}`));
};

function fromNetscape(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (!line.trim() || line.startsWith("#")) continue;
    // WhatsApp may turn tabs into spaces when the file is pasted as text.
    let f = line.split("\t");
    const tabbed = f.length >= 7;
    if (!tabbed) f = line.trim().split(/\s+/);
    if (f.length < 7) continue;
    const [domain, , cpath, secure, expires, name, ...value] = f;
    // Space-separated: a value with spaces was split, so glue it back with spaces.
    out.push({ domain, path: cpath, secure: /^true$/i.test(secure), expires: Number(expires) || 0, name, value: value.join(tabbed ? "" : " "), httpOnly });
  }
  return out;
}

function fromJson(list) {
  if (!Array.isArray(list)) list = list?.cookies;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && c.name && c.domain)
    .map((c) => ({
      domain: c.hostOnly === false || String(c.domain).startsWith(".") ? `.${String(c.domain).replace(/^\./, "")}` : c.domain,
      path: c.path || "/",
      secure: Boolean(c.secure),
      expires: Math.floor(Number(c.expirationDate ?? c.expires ?? 0)) || 0,
      name: c.name,
      value: c.value ?? "",
      httpOnly: Boolean(c.httpOnly),
    }));
}

function fromHeader(text, site) {
  const domain = `.${HOSTS[site][0]}`;
  return text
    .replace(/^cookie:\s*/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.includes("="))
    .map((p) => {
      const i = p.indexOf("=");
      return { domain, path: "/", secure: true, expires: 0, name: p.slice(0, i).trim(), value: p.slice(i + 1).trim(), httpOnly: false };
    });
}

/**
 * Parses any supported format and keeps the site's cookies.
 * @returns {{ cookies: object[], dropped: number, format: string }}
 */
function parse(input, site) {
  const raw = String(input || "");
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim(); // drop a byte-order mark
  if (!text) throw new UserError("The cookie text is empty.");
  if (text.length > MAX_INPUT) throw new UserError("That is too big for a cookie file (max 1 MB).");
  let all;
  let format;
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      all = fromJson(JSON.parse(text));
      format = "JSON";
    } catch {
      throw new UserError("That looks like JSON but could not be read. Export the cookies again.");
    }
  } else if (/^#\s*(Netscape )?HTTP Cookie File/i.test(text) || text.split("\n").some((l) => l.split("\t").length >= 7)) {
    all = fromNetscape(text);
    format = "cookies.txt";
  } else if (/^[^=;\s]+=[^;]*(;\s*[^=;\s]+=[^;]*)*;?$/.test(text.replace(/^cookie:\s*/i, "").replace(/\s*\n\s*/g, " "))) {
    all = fromHeader(text.replace(/\s*\n\s*/g, " "), site);
    format = "header string";
  } else {
    throw new UserError("I couldn't read those cookies. Send a cookies.txt file (Netscape format) or a Cookie-Editor JSON export.");
  }
  const cookies = all
    .filter((c) => domainOk(c.domain, site))
    .map((c) => ({ ...c, domain: clean(c.domain), path: clean(c.path) || "/", name: clean(c.name), value: clean(c.value) }))
    .filter((c) => c.name && /^[\x21-\x7e]+$/.test(c.name))
    .slice(0, MAX_COOKIES);
  return { cookies, dropped: all.length - cookies.length, format };
}

function toNetscape(cookies) {
  const lines = cookies.map((c) => {
    const sub = c.domain.startsWith(".") ? "TRUE" : "FALSE";
    const domain = c.httpOnly ? `#HttpOnly_${c.domain}` : c.domain;
    return [domain, sub, c.path, c.secure ? "TRUE" : "FALSE", String(c.expires || 0), c.name, c.value].join("\t");
  });
  return `${HEADER}\n${lines.join("\n")}\n`;
}

/** Facts about a cookie set, without any values. */
function summarize(cookies, site, now = Date.now() / 1000) {
  const login = cookies.filter((c) => (LOGIN_COOKIES[site] || []).includes(c.name));
  const live = (c) => !c.expires || c.expires > now;
  const expired = cookies.filter((c) => !live(c)).length;
  const loginExpiry = login.filter(live).map((c) => c.expires).filter(Boolean);
  return {
    count: cookies.length,
    expired,
    loggedIn: login.some(live),
    knowsLogin: Boolean(LOGIN_COOKIES[site]),
    loginExpires: loginExpiry.length ? new Date(Math.min(...loginExpiry) * 1000) : null,
  };
}

function save(config, site, cookies) {
  if (!cookies.length) throw new UserError(`No cookies for ${site} were found in that. Export them while on ${HOSTS[site][0]}.`);
  fs.mkdirSync(dirOf(config), { recursive: true, mode: 0o700 });
  const file = fileFor(config, site);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, toNetscape(cookies), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function read(config, site) {
  const file = fileFor(config, site);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { cookies: fromNetscape(fs.readFileSync(file, "utf8")), updated: stat.mtime };
}

function remove(config, site) {
  const file = fileFor(config, site);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

const savedSites = (config) => Object.keys(HOSTS).filter((s) => fs.existsSync(fileFor(config, s)));

module.exports = { ytdlpArgs, parse, toNetscape, summarize, save, read, remove, savedSites, fileFor };
