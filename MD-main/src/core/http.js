"use strict";

const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const net = require("node:net");
const zlib = require("node:zlib");

/**
 * SSRF-safe HTTP client for every outbound request the bot makes.
 *  - https only (http is refused unless `allowHttp` is set for a specific trusted call)
 *  - the resolved IP of every connection is checked at connect time (no DNS-rebinding
 *    window): loopback, private, link-local, CGNAT, multicast and reserved ranges are refused
 *  - redirects are followed manually and each hop is re-validated
 *  - hard timeout and a byte cap on the response body
 */

class HttpError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return blocked.check(address, "ipv4");
}

/** Validates a URL before any network activity. Throws HttpError on refusal. */
function assertSafeUrl(input, { allowHttp = false } = {}) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw new HttpError("Invalid URL", { code: "BAD_URL" });
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new HttpError(`Blocked URL scheme ${url.protocol}`, { code: "BAD_SCHEME" });
  }
  if (url.username || url.password) throw new HttpError("URLs with credentials are not allowed", { code: "BAD_URL" });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new HttpError("Blocked private or reserved address", { code: "BLOCKED_ADDRESS" });
  }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new HttpError("Blocked internal hostname", { code: "BLOCKED_ADDRESS" });
  }
  return url;
}

/** dns.lookup replacement used at connect time; rejects private addresses. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new HttpError(`Blocked address for ${hostname}`, { code: "BLOCKED_ADDRESS" }));
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function requestOnce(url, { method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method,
        headers: { "user-agent": DEFAULT_UA, "accept-encoding": "gzip, deflate, br", ...headers },
        lookup: safeLookup,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url), status });
        }
        const declared = Number(res.headers["content-length"] || 0);
        if (declared && declared > maxBytes) {
          res.destroy();
          return reject(new HttpError(`Response too large (${declared} bytes)`, { status, code: "TOO_LARGE" }));
        }
        let stream = res;
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

        const chunks = [];
        let size = 0;
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            stream.destroy();
            reject(new HttpError("Response too large", { status, code: "TOO_LARGE" }));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("error", (err) => reject(err));
        stream.on("end", () =>
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: url.toString() }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new HttpError("Request timed out", { code: "TIMEOUT" })));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * request(url, options) → { status, headers, body: Buffer, url }
 * Options: method, headers, body (Buffer|string), timeoutMs (20s), maxBytes (10 MB),
 *          maxRedirects (5), allowHttp (false),
 *          throwOnStatus (true: non-2xx throws HttpError; false: the response is returned)
 */
async function request(input, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 20000,
    maxBytes = 10 * 1024 * 1024,
    maxRedirects = 5,
    allowHttp = false,
    throwOnStatus = true,
  } = opts;
  let url = assertSafeUrl(input, { allowHttp });
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, { method, headers, body, timeoutMs, maxBytes });
    if (!res.redirect) {
      if (throwOnStatus && (res.status < 200 || res.status >= 300)) {
        throw new HttpError(`HTTP ${res.status} from ${url.hostname}`, { status: res.status, code: "HTTP_STATUS" });
      }
      return res;
    }
    url = assertSafeUrl(res.redirect, { allowHttp });
  }
  throw new HttpError("Too many redirects", { code: "REDIRECTS" });
}

async function getJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  try {
    return JSON.parse(res.body.toString("utf8"));
  } catch {
    throw new HttpError(`Invalid JSON from ${new URL(url).hostname}`, { code: "BAD_JSON" });
  }
}

/** Downloads a resource as a Buffer. Returns { buffer, contentType }. */
async function getBuffer(url, opts = {}) {
  const res = await request(url, opts);
  return { buffer: res.body, contentType: String(res.headers["content-type"] || "") };
}

/** Builds a multipart/form-data body without extra dependencies. */
function multipart(fields) {
  const boundary = `----bot${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) head += `; filename="${f.filename.replace(/"/g, "")}"`;
    head += "\r\n";
    if (f.contentType) head += `Content-Type: ${f.contentType}\r\n`;
    parts.push(Buffer.from(head + "\r\n"), Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)), Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

module.exports = { request, getJson, getBuffer, multipart, assertSafeUrl, isBlockedAddress, safeLookup, HttpError };
