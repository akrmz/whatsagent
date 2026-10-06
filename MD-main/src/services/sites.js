"use strict";

/** Sites the downloaders accept, and the cookies that show you are logged in on each. */

const HOSTS = {
  youtube: ["youtube.com", "youtu.be", "music.youtube.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch"],
  instagram: ["instagram.com", "instagr.am"],
  twitter: ["twitter.com", "x.com"],
  reddit: ["reddit.com", "redd.it"],
  soundcloud: ["soundcloud.com"],
  pinterest: ["pinterest.com", "pin.it"],
  vimeo: ["vimeo.com"],
  dailymotion: ["dailymotion.com", "dai.ly"],
  twitch: ["twitch.tv"],
  threads: ["threads.net", "threads.com"],
  snapchat: ["snapchat.com"],
};

/** Sites whose links are music; .dl sends these as audio. */
const AUDIO_SITES = new Set(["soundcloud"]);

// Cookie names that only exist while logged in (used to warn about logged-out exports).
const LOGIN_COOKIES = {
  youtube: ["SID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO", "SAPISID"],
  instagram: ["sessionid"],
  facebook: ["c_user", "xs"],
  tiktok: ["sessionid", "sid_tt"],
  twitter: ["auth_token"],
  reddit: ["reddit_session", "token_v2"],
  soundcloud: ["oauth_token"],
  pinterest: ["_pinterest_sess"],
  vimeo: ["vimeo"],
  twitch: ["auth-token"],
  threads: ["sessionid"],
};

// Cookies for a site are stored for its own domains; YouTube logins live on google.com too.
const COOKIE_DOMAINS = { ...HOSTS, youtube: [...HOSTS.youtube, "google.com"] };

const hostIn = (host, site) => HOSTS[site].some((h) => host === h || host.endsWith(`.${h}`));

/** Accepts "youtube", "yt", "ig", "x" … and returns the site key, or null. */
const ALIASES = { yt: "youtube", ytmusic: "youtube", ig: "instagram", insta: "instagram", fb: "facebook", tt: "tiktok", x: "twitter", sc: "soundcloud" };
function siteKey(name) {
  const n = String(name || "").toLowerCase().replace(/\.com$/, "");
  if (Object.hasOwn(HOSTS, n)) return n;
  return ALIASES[n] || null;
}

module.exports = { HOSTS, AUDIO_SITES, LOGIN_COOKIES, COOKIE_DOMAINS, hostIn, siteKey };
