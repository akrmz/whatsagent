"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");
const { normalizePhone } = require("./phones");
const newlisting = require("./newlisting");
const { limiterFor } = require("../core/ratelimit");
const { UserError } = require("../core/errors");

/**
 * Listings waiting for a look (.drafts): units collected from posts the owner forwards to the bot
 * and from a followed WhatsApp channel (.channel). A unit's text and photos arrive as separate
 * messages (an album is one message per photo), so they are grouped by where they came from and
 * time: a draft takes what comes from the same place until 2 minutes pass, or the next post is
 * another unit. Then the owner gets it to check, and ".drafts save 3" makes it a listing with its
 * photos. Channel posts are text from outside, so what is kept is bounded (B-24's rule).
 *   DATA_DIR/drafts.json { seq, items: { [id]: draft }, off }
 *   draft: { id, source: { kind: "forward"|"channel", key, name, notify }, texts: [], photos,
 *            contacts: [], created, updated, reviewed?, by? }
 *   DATA_DIR/drafts/<id>/<n>.jpg (re-encoded)
 */

const IDLE = 2 * 60 * 1000; // a unit's messages come together; 2 quiet minutes and it is complete
const MAX_OPEN = 50; // drafts waiting
const MAX_PHOTOS = re.MAX_PHOTOS; // as a listing
const MAX_TEXT = 4000;
const EXPIRE_AFTER = 14 * 24 * 3600 * 1000;
const NOTIFY_PER_HOUR = 20; // review messages; more wait in .drafts

const store = (state) => state.store("drafts", { seq: 0, items: {}, off: false });
const get = (state, id) => store(state).data.items[Number(id)] || null;
const open = (state) => Object.values(store(state).data.items).sort((a, b) => a.id - b.id);
const isOff = (state) => Boolean(store(state).data.off);
const setOff = (state, off) => store(state).update((d) => (d.off = Boolean(off)));

const dir = (config, id) => path.join(config.paths.data, "drafts", String(Number(id)));
const photoFile = (config, id, n) => path.join(dir(config, id), `${Number(n)}.jpg`);
const dropFiles = (config, id) => fs.rmSync(dir(config, id), { recursive: true, force: true });

// Phone numbers in a post (a broker's or an owner's): kept privately on the draft for the agent,
// never in the listing's public description.
const PHONE = /(?:\+|00)\d[\d\s-]{7,16}\d|(?<![\d,.])0\d(?:[\s-]?\d){8,13}(?![\d,.])/g;
function splitContacts(text, ownerNumber) {
  const t = re.latinDigits(re.squeeze(text));
  const contacts = [...new Set((t.match(PHONE) || []).map((p) => normalizePhone(p, ownerNumber)).filter(Boolean))];
  const clean = t
    .split("\n")
    .map((line) => line.replace(PHONE, " ").replace(/(?:للتواصل|للاستفسار|تواصل|اتصل|واتساب|واتس|whatsapp|call|contact)\s*[:：]?\s*$/iu, "").trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .join("\n");
  return { clean, contacts };
}

/** The listing fields read from a draft's texts (phone numbers left out of the description). */
function fieldsOf(d, ownerNumber) {
  const f = re.parseListingText(splitContacts(d.texts.join("\n"), ownerNumber).clean, ownerNumber);
  delete f.owner; // only an explicit "المالك:" line in an edit names the owner
  return f;
}

/** Drop drafts untouched for 14 days, with their photos. */
function expire(state, config, now = Date.now()) {
  for (const d of open(state).filter((x) => now - x.updated > EXPIRE_AFTER)) {
    dropFiles(config, d.id);
    store(state).update((s) => delete s.items[d.id]);
  }
}

/**
 * Adds a message (text and/or a re-encoded JPEG) to the draft collecting for this source, or
 * starts one. @returns {{ draft, isNew } | { full: true } | { skipped: "photos" }}
 */
function collect(state, config, { source, text, jpeg, by, ownerNumber }, now = Date.now()) {
  expire(state, config, now);
  const t = String(text || "").trim();
  const current = open(state)
    .filter((d) => d.source.key === source.key && !d.reviewed && now - d.updated < IDLE)
    .at(-1);
  // The next unit: this text is a listing of its own and the current draft already has one.
  const another = current && t && re.parseListingText(t).type && fieldsOf(current, ownerNumber).type;
  if (current && !another) {
    if (jpeg && current.photos >= MAX_PHOTOS) return { skipped: "photos" };
    if (jpeg) writePhoto(config, current.id, current.photos + 1, jpeg);
    const d = store(state).update((s) => {
      const x = s.items[current.id];
      if (t && x.texts.join("\n").length + t.length <= MAX_TEXT) x.texts.push(t);
      if (jpeg) x.photos++;
      x.updated = now;
      return x;
    });
    return { draft: d, isNew: false };
  }
  if (!t && !jpeg) return { skipped: "empty" };
  if (open(state).length >= MAX_OPEN) return { full: true };
  const d = store(state).update((s) => {
    const id = ++s.seq;
    s.items[id] = { id, source, texts: t ? [t.slice(0, MAX_TEXT)] : [], photos: 0, created: now, updated: now, ...(by ? { by } : {}) };
    return s.items[id];
  });
  if (jpeg) {
    writePhoto(config, d.id, 1, jpeg);
    store(state).update((s) => (s.items[d.id].photos = 1));
  }
  return { draft: get(state, d.id), isNew: true };
}

function writePhoto(config, id, n, jpeg) {
  fs.mkdirSync(dir(config, id), { recursive: true, mode: 0o700 });
  fs.writeFileSync(photoFile(config, id, n), jpeg, { mode: 0o600 });
}

/** Drafts complete (2 quiet minutes) and not shown to the owner yet, oldest first. */
const due = (state, now = Date.now()) => open(state).filter((d) => !d.reviewed && now - d.updated >= IDLE);
const markReviewed = (state, id, now = Date.now()) => store(state).update((s) => s.items[id] && (s.items[id].reviewed = now));
const notifyBudget = (state) => limiterFor(state, "drafts-notify", { max: NOTIFY_PER_HOUR, windowMs: 3600 * 1000, size: 1 })("all");

const photos = (config, d) => Array.from({ length: d.photos || 0 }, (_, i) => photoFile(config, d.id, i + 1)).filter((p) => fs.existsSync(p));

/** The review message (its caption, with the first photo). */
function reviewText(state, d, { p = ".", ownerNumber } = {}) {
  const f = fieldsOf(d, ownerNumber);
  const { contacts } = splitContacts(d.texts.join("\n"), ownerNumber);
  const preview = Object.keys(f).filter((k) => k !== "notes").length ? re.card({ id: "؟", status: "available", ...f }, re.agent(state)) : "⚠️ مش واضح ده عقار إيه — مفيش نوع ولا سعر في الكلام";
  const dup = re.findDuplicate(state, f);
  const from = d.source.kind === "channel" ? `من قناة "${d.source.name || "القناة"}"` : "من الرسائل اللي حوّلتها";
  const missing = [!f.type && "النوع", !f.price && "السعر", !f.location && "المنطقة"].filter(Boolean);
  return [
    `📥 *مسودة #${d.id}* — ${from}`,
    "",
    preview,
    "",
    `📷 ${d.photos} صورة${d.photos >= MAX_PHOTOS ? " (الحد الأقصى)" : ""}`,
    contacts.length ? `📞 أرقام في البوست (خاصة، مش هتظهر في الكارت): ${contacts.map((c) => `+${c}`).join(" · ")}` : null,
    dup ? `⚠️ شكلها زي #${dup.id} المحفوظ` : null,
    missing.length ? `✏️ ناقص: ${missing.join("، ")} — ضيفه وانت بتحفظ: ${p}drafts save ${d.id} ${!f.type ? "النوع: شقة" : !f.price ? "السعر: 3 مليون" : "المنطقة: التجمع"}` : null,
    "",
    `احفظها: ${p}drafts save ${d.id} · بتعديل: ${p}drafts save ${d.id} السعر: … · امسحها: ${p}drafts del ${d.id}`,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/**
 * The draft as a listing, with its photos; "edits" are listing lines that win ("السعر: 3.2 مليون",
 * "المالك: أبو أحمد 0100…"). @returns {object} the listing
 */
function save(state, config, id, { edits = "", by, ownerNumber, base } = {}) {
  const d = get(state, id);
  if (!d) throw new UserError(`There is no draft #${id} (.drafts).`);
  const extra = edits ? re.parseListingText(edits, ownerNumber) : {};
  const fields = { ...(base || fieldsOf(d, ownerNumber)), ...extra }; // base: read by the AI, or with a Maps pin
  if (!fields.type) throw new UserError(`What kind of property is it? .drafts save ${id} النوع: شقة (and any other missing details).`);
  const l = re.add(state, fields, by);
  let added = 0;
  for (const file of photos(config, d)) {
    if (added >= MAX_PHOTOS) break;
    re.addPhoto(state, config, l.id, fs.readFileSync(file));
    added++;
  }
  dropFiles(config, id);
  store(state).update((s) => delete s.items[id]);
  return re.get(state, l.id);
}

function remove(state, config, id) {
  const d = get(state, id);
  if (!d) throw new UserError(`There is no draft #${id} (.drafts).`);
  dropFiles(config, id);
  store(state).update((s) => delete s.items[id]);
  return d;
}

/** One line for the list. */
function line(state, d, ownerNumber) {
  const f = fieldsOf(d, ownerNumber);
  const what = [f.type || "؟", f.deal && `لل${f.deal}`, f.location && `— ${String(f.location).slice(0, 30)}`, f.price && `— ${re.shortAr(f.price)}`].filter(Boolean).join(" ");
  return `▫️ *#${d.id}* ${what} · 📷 ${d.photos}${d.source.kind === "channel" ? ` · 📢 ${d.source.name || "قناة"}` : " · ↪️"}`;
}

/**
 * Sends each complete draft to the chat it is reviewed in (the owner's), with its first photo;
 * a channel draft marked "auto" is saved straight away instead. @returns {Promise<number>} sent
 */
async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  const p = app.config.bot.prefix;
  const ownerNumber = app.config.owners.numbers[0];
  let sent = 0;
  for (const d of due(app.state, now)) {
    const to = d.source.notify || (ownerNumber && `${ownerNumber}@s.whatsapp.net`);
    if (!to) continue;
    if (d.source.auto) {
      try {
        // As any new listing: a short Maps link opened (limited: this is outside text), then the
        // price check, the clients it suits and, with autoblast on, the campaign.
        const base = await newlisting.shortLinkGeo(fieldsOf(d, ownerNumber), d.texts.join("\n"), { state: app.state });
        const dup = re.findDuplicate(app.state, base);
        const l = save(app.state, app.config, d.id, { by: d.by || "channel", ownerNumber, base });
        const env = { state: app.state, config: app.config, prefix: p };
        const more = newlisting.afterAdd(env, l, { by: d.by, chat: to, showNames: !to.endsWith("@g.us"), duplicate: dup });
        if (notifyBudget(app.state)) {
          await app.sock
            .sendMessage(to, { text: `✅ اتضاف *#${l.id}* من قناة "${d.source.name || "القناة"}" (📷 ${l.photos || 0})\n${re.line(l, re.agent(app.state).currency)}${dup ? `\n⚠️ شكله زي #${dup.id}` : ""}\n${p}listing ${l.id} · لو غلط: ${p}listing del ${l.id}${more}` })
            .catch(() => {});
        }
        sent++;
        continue;
      } catch {
        // Not readable as a listing (no type): it waits for a look like any other.
      }
    }
    if (!notifyBudget(app.state)) break; // the rest wait in .drafts
    markReviewed(app.state, d.id, now);
    const text = reviewText(app.state, d, { p, ownerNumber });
    const [first] = photos(app.config, d);
    try {
      await app.sock.sendMessage(to, first ? { image: fs.readFileSync(first), caption: text } : { text });
      sent++;
    } catch (err) {
      app.log.warn({ err: err.message, draft: d.id }, "draft review not sent");
    }
  }
  return sent;
}

function startDraftsLoop(app) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      expire(app.state, app.config);
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "drafts loop failed");
    } finally {
      busy = false;
    }
  }, 30 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { runDue, startDraftsLoop, collect, due, markReviewed, notifyBudget, reviewText, save, remove, get, open, line, photos, fieldsOf, splitContacts, expire, isOff, setOff, IDLE, MAX_OPEN, MAX_PHOTOS, EXPIRE_AFTER };
