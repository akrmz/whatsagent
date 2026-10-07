"use strict";

const dns = require("node:dns").promises;
const tls = require("node:tls");
const http = require("../core/http");
const { UserError } = require("../core/errors");

/**
 * Website checks (.dns, .ssl, .up). Only public names: internal addresses are refused the
 * same way as everywhere else (core/http safeLookup), so the bot can't be used to probe the
 * server's own network.
 */

/** "https://www.Example.com/x", "user@example.com", "مثال.مصر" → "www.example.com" (punycode), or null. */
function domainOf(text) {
  let s = String(text || "").trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^[^@\s]+@/, "").split(/[/?#:\s]/)[0];
  let host;
  try {
    host = new URL(`http://${s}`).hostname;
  } catch {
    return null;
  }
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host) || /^\d+(\.\d+){3}$/.test(host)) return null;
  return host;
}

/**
 * A, AAAA, CNAME, MX, NS and TXT records; a type with no records is left out.
 * One query at a time: some resolvers answer six parallel queries far more slowly
 * (8–11 s instead of ~3 s in total, measured), which made every type time out.
 */
async function lookup(host, resolver = new dns.Resolver({ timeout: 4000, tries: 2 })) {
  const tries = {
    A: () => resolver.resolve4(host),
    AAAA: () => resolver.resolve6(host),
    CNAME: () => resolver.resolveCname(host),
    MX: async () => (await resolver.resolveMx(host)).sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`),
    NS: () => resolver.resolveNs(host),
    TXT: async () => (await resolver.resolveTxt(host)).map((parts) => parts.join("")),
  };
  const out = {};
  const deadline = Date.now() + 25000;
  for (const [type, fn] of Object.entries(tries)) {
    if (Date.now() > deadline) break;
    try {
      const list = await fn();
      if (list.length) out[type] = list;
    } catch {
      /* no records of this type (or the lookup failed) */
    }
  }
  return out;
}

/**
 * The TLS certificate a site presents on port 443.
 * @returns {Promise<{ subject, issuer, validFrom, validTo, daysLeft, names: string[], trusted: boolean, problem: string|null, protocol }>}
 */
function certificate(host, now = Date.now()) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, lookup: http.safeLookup, rejectUnauthorized: false, timeout: 10000 });
    const fail = (err) => {
      socket.destroy();
      reject(err.code === "BLOCKED_ADDRESS" ? new UserError("That address is not allowed.") : new UserError(`Couldn't connect to ${host} on port 443 (${err.code || err.message}).`));
    };
    socket.once("error", fail);
    socket.once("timeout", () => fail(new Error("timed out")));
    socket.once("secureConnect", () => {
      const c = socket.getPeerCertificate();
      const result = {
        subject: c.subject?.CN || "",
        issuer: [c.issuer?.O, c.issuer?.CN].filter(Boolean).join(" — "),
        validFrom: new Date(c.valid_from).toISOString().slice(0, 10),
        validTo: new Date(c.valid_to).toISOString().slice(0, 10),
        daysLeft: Math.floor((Date.parse(c.valid_to) - now) / 86400000),
        names: String(c.subjectaltname || "")
          .split(/,\s*/)
          .map((n) => n.replace(/^DNS:/, ""))
          .filter(Boolean),
        trusted: socket.authorized,
        problem: socket.authorized ? null : String(socket.authorizationError || "not trusted"),
        protocol: socket.getProtocol(),
      };
      socket.end();
      resolve(result);
    });
  });
}

/** Is the site answering? Follows redirects; any HTTP answer counts as "up". */
async function check(url) {
  const started = Date.now();
  try {
    const res = await http.request(url, { method: "GET", allowHttp: true, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, throwOnStatus: false, headers: { "accept-encoding": "identity" } });
    return { up: true, status: res.status, ms: Date.now() - started, finalUrl: res.url };
  } catch (err) {
    if (err.code === "TOO_LARGE") return { up: true, status: err.status, ms: Date.now() - started, finalUrl: url };
    if (err.code === "BLOCKED_ADDRESS") throw new UserError("That address is not allowed.");
    return { up: false, error: err.code || err.message, ms: Date.now() - started };
  }
}

module.exports = { domainOf, lookup, certificate, check };
