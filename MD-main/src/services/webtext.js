"use strict";

const { request } = require("../core/http");
const { UserError } = require("../core/errors");

/**
 * Fetches a public web page through the SSRF-safe client and returns its readable text.
 * No JavaScript is run; pages that render only in the browser give little text.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → { title, text }. Prefers <article>/<main> when present. */
function htmlToText(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim());
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");
  const main = body.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0];
  if (main && main.length > 500) body = main;
  // Articles are mostly <p>aragraphs: when there is enough of them, keep only headings,
  // paragraphs and list items, which drops menus, language lists and link farms.
  const blocks = body.match(/<(h[1-6]|p|li|blockquote|pre)\b[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const paragraphText = blocks.filter((b) => /^<p\b/i.test(b)).join(" ").replace(/<[^>]+>/g, "");
  const textLength = (b) => b.replace(/<[^>]+>/g, "").trim().length;
  if (paragraphText.length > 1500) body = blocks.filter((b) => !/^<li\b/i.test(b) || textLength(b) >= 40).join("\n");
  body = body
    .replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n");
  return { title, text };
}

async function fetchPageText(url, { maxBytes = 3 * 1024 * 1024 } = {}) {
  // Plain http is allowed for reading pages; private and local addresses are still blocked.
  const res = await request(url, { timeoutMs: 20000, maxBytes, allowHttp: true, headers: { accept: "text/html,text/plain;q=0.9" } });
  const type = String(res.headers["content-type"] || "");
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new UserError("That link is not a web page I can read.");
  const raw = res.body.toString("utf8");
  if (/text\/plain/i.test(type)) return { title: "", text: raw.trim() };
  return htmlToText(raw);
}

module.exports = { fetchPageText, htmlToText, decodeEntities };
