"use strict";

const re = require("./realestate");
const { getText } = require("../core/context");

/**
 * A client who replies to a listing's card (from "#12", a campaign, the assistant) usually asks
 * about that very unit: "لسه متاحة؟", "فيه صور تانية؟", "فيه فيديو؟", "اللوكيشن فين؟". Those get
 * an answer straight away, without the AI; other questions go on to the assistant, which is told
 * which unit the client means.
 */

/** The listing a quoted message is about ("#12" in it), or null. */
function quotedListing(ctx) {
  const t = ctx.quoted ? re.latinDigits(getText(ctx.quoted.message)) : "";
  const m = t.match(/#\s?(\d{1,5})(?!\d)/);
  return (m && re.get(ctx.state, Number(m[1]))) || null;
}

const INTENTS = [
  ["video", /فيديو|فديو|video/iu],
  ["photos", /صور|صوره|صورة|الصور|photos?|pictures?|pics?/iu],
  ["location", /لوكيشن|اللوكيشن|الموقع|موقعها|موقعه|مكانها|مكانه|فين|عنوان|location|address|map|where/iu],
  ["available", /متاح|متاحة|متاحه|موجود|موجودة|موجوده|لسه|اتباع|اتحجز|available|still|sold/iu],
];

/** What a short reply asks: "video", "photos", "location", "available", or null. */
function intentOf(text) {
  const t = re.squeeze(String(text || "")).trim();
  if (!t || t.length > 120) return null;
  return INTENTS.find(([, rx]) => rx.test(t))?.[0] || null;
}

module.exports = { quotedListing, intentOf };
