"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharelinks = require("../src/services/sharelinks");

/** A fake Facebook: answers each user-agent the way the real one did on 2026-10-06. */
function fakeFacebook(map) {
  const calls = [];
  sharelinks.setRequester(async (url, opts) => {
    calls.push({ url, ua: opts.headers["user-agent"], followRedirects: opts.followRedirects });
    const r = map(url, opts.headers["user-agent"]);
    if (r instanceof Error) throw r;
    return r;
  });
  return calls;
}

test("Facebook share links resolve to the real reel, without tracking parameters", async (t) => {
  t.after(() => sharelinks.setRequester(null));
  const calls = fakeFacebook((url, ua) =>
    ua.startsWith("facebookexternalhit")
      ? { status: 302, redirect: "https://www.facebook.com/reel/1589652085979881/?rdid=abc&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fr%2F19asd4eqWK%2F" }
      : { status: 400 },
  );
  assert.equal(await sharelinks.resolve("https://www.facebook.com/share/r/19asd4eqWK/"), "https://www.facebook.com/reel/1589652085979881/");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].followRedirects, false, "only the redirect is read, not the page");
});

test("only Facebook share links are touched; anything doubtful keeps the original link", async (t) => {
  t.after(() => sharelinks.setRequester(null));
  const calls = fakeFacebook((url, ua) => {
    if (url.includes("/share/v/LOGIN")) return { status: 302, redirect: "https://www.facebook.com/login/?next=x" };
    if (url.includes("/share/v/ELSEWHERE")) return { status: 302, redirect: "https://evil.example/reel/1/" };
    if (url.includes("/share/v/DOWN")) return new Error("ECONNRESET");
    if (url.includes("fb.watch")) return { status: 301, redirect: "https://www.facebook.com/watch/?v=123&mibextid=z" };
    return ua === "curl/8.9.1" ? { status: 302, redirect: "https://m.facebook.com/reel/42/?refsrc=deprecated" } : { status: 200 };
  });

  for (const link of ["https://www.facebook.com/reel/1589652085979881/", "https://www.youtube.com/watch?v=x", "https://www.facebook.com/groups/1/", "not a url"]) {
    assert.equal(await sharelinks.resolve(link), link);
  }
  assert.equal(calls.length, 0, "no request for links that aren't share links");

  assert.equal(await sharelinks.resolve("https://www.facebook.com/share/v/LOGIN123/"), "https://www.facebook.com/share/v/LOGIN123/", "the login page is not a video");
  assert.equal(await sharelinks.resolve("https://www.facebook.com/share/v/ELSEWHERE1/"), "https://www.facebook.com/share/v/ELSEWHERE1/", "must stay on Facebook");
  assert.equal(await sharelinks.resolve("https://www.facebook.com/share/v/DOWN1/"), "https://www.facebook.com/share/v/DOWN1/", "network error: unchanged");
  assert.equal(await sharelinks.resolve("https://fb.watch/abcDEF123/"), "https://www.facebook.com/watch/?v=123", "keeps v=, drops tracking");
  assert.equal(await sharelinks.resolve("https://m.facebook.com/share/r/19asd4eqWK"), "https://m.facebook.com/reel/42/", "second user-agent when the first gets no redirect");
});

test("share link patterns", () => {
  const is = (u) => sharelinks.isFacebookShare(new URL(u));
  assert.equal(is("https://www.facebook.com/share/r/19asd4eqWK/"), true);
  assert.equal(is("https://www.facebook.com/share/v/1AbCdEf/"), true);
  assert.equal(is("https://web.facebook.com/share/p/1AbCdEf"), true);
  assert.equal(is("https://www.facebook.com/share/1AbCdEf/"), true);
  assert.equal(is("https://fb.watch/abc/"), true);
  assert.equal(is("https://www.facebook.com/reel/1/"), false);
  assert.equal(is("https://www.facebook.com/share/r/19asd4eqWK/../../x"), false);
  assert.equal(is("https://notfacebook.com/share/r/19asd4eqWK/"), false);
  assert.equal(sharelinks.cleanTarget("http://www.facebook.com/reel/1/"), null, "https only");
  assert.equal(sharelinks.cleanTarget("https://user:pw@www.facebook.com/reel/1/"), null);
});
