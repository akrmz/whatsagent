"use strict";

const http = require("../core/http");
const { hostIn } = require("./sites");

/**
 * Share links that yt-dlp can't open by themselves, resolved to the real post first.
 *
 * Facebook's "Share" button makes links like facebook.com/share/r/<code>/ (reels),
 * /share/v/ (videos) and /share/p/ (posts). Facebook answers them with HTTP 400 for
 * browser-like clients (yt-dlp), but redirects its own link-preview crawler and plain
 * clients to the real page (facebook.com/reel/<id>/). Only that one redirect is read —
 * the page itself is not downloaded — and it is used only if it stays on Facebook.
 */

// Replaceable in tests (offline fixtures).
let request = http.request;
const setRequester = (fn) => (request = fn || http.request);

const FACEBOOK_SHARE = /^\/share\/(?:[a-z]\/)?[A-Za-z0-9_-]{5,40}\/?$/;
const AGENTS = ["facebookexternalhit/1.1", "curl/8.9.1"];
const TRACKING = ["rdid", "share_url", "mibextid", "referral_source", "original_uri", "_rdr", "refsrc"];

function isFacebookShare(url) {
  const host = url.hostname.toLowerCase();
  if (!hostIn(host, "facebook")) return false;
  return host === "fb.watch" || FACEBOOK_SHARE.test(url.pathname);
}

/** A redirect target we accept: https, still Facebook, not the login or checkpoint page, and a real post. */
function cleanTarget(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !hostIn(u.hostname.toLowerCase(), "facebook")) return null;
  if (/^\/(login|checkpoint|share)\b/.test(u.pathname) || u.pathname === "/") return null;
  for (const p of TRACKING) u.searchParams.delete(p);
  u.hash = "";
  return u.toString();
}

/**
 * @param {string} link a URL from the user
 * @returns {Promise<string>} the real post URL for a Facebook share link; otherwise (or if
 *   it can't be resolved) the link unchanged, so the download behaves as before
 */
async function resolve(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  if (!isFacebookShare(url)) return link;
  for (const agent of AGENTS) {
    try {
      const res = await request(url.toString(), {
        method: "GET",
        headers: { "user-agent": agent, accept: "text/html" },
        followRedirects: false,
        throwOnStatus: false,
        timeoutMs: 15000,
        maxBytes: 2 * 1024 * 1024,
      });
      const target = res.redirect && cleanTarget(res.redirect);
      if (target) return target;
    } catch {
      /* try the next way, then give up and keep the link */
    }
  }
  return link;
}

module.exports = { resolve, isFacebookShare, cleanTarget, setRequester };
