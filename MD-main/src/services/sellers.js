"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");
const img = require("./reimages");
const { limiterFor } = require("../core/ratelimit");
const { UserError } = require("../core/errors");

/**
 * Owners who want to sell or rent out (.agent sellers on): "عايز أبيع شقتي في التجمع" in a
 * private chat is answered with what to send (details and photos); for the next 20 minutes
 * their texts and photos are collected as an offer, and the agent is told. Nothing reaches the
 * catalogue until the agent adds it (.sellers add 3), with the person saved as the listing's owner.
 *   DATA_DIR/sellers.json { seq, items: { [id]: offer } }
 *   offer: { id, phone, name, deal, text, fields, photos, at, updated, openUntil, thanked?, status: "new"|"added"|"dismissed", listing? }
 *   photos: DATA_DIR/sellers/<id>/<n>.jpg until the offer is added (moved to the listing) or dismissed.
 */

const OPEN_FOR = 20 * 60 * 1000; // details and photos are collected for 20 minutes after their last message
const MAX_TEXT = 1500;
const MAX_PHOTOS = 8;
const MAX_KEPT = 300;
// Strangers can start offers and send photos: what waits for the agent is bounded (B-24).
const MAX_OPEN = 100; // offers waiting for the agent
const MAX_STORED_PHOTOS = 400; // photos of all waiting offers together
const EXPIRE_AFTER = 30 * 24 * 3600 * 1000; // a waiting offer untouched this long is dropped, photos too

// "أبيع / أأجر …", or "my flat … for sale/rent". Not "اعرض" (also "show me") nor "أجرها" (also "its rent").
const SELL_VERB = /(?<![\p{L}])(?:ابيع|أبيع|ابيعها|أبيعها|ابيعه|أبيعه|نبيع|هبيع|اأجر|أأجر|اأجرها|أأجرها|أأجره|هأجر|sell my|rent out my)(?![\p{L}])/iu;
const MINE = /(?<![\p{L}])(?:شقتي|شقتى|فيلتي|بيتي|عقاري|محلي|ارضي|أرضي|شاليهي|مكتبي|عيادتي|عمارتي|my (?:flat|apartment|villa|house|property))(?![\p{L}])/iu;
const FOR_DEAL = /(?<![\p{L}])(?:للبيع|للإيجار|للايجار|for sale|for rent)(?![\p{L}])/iu;
const RENT = /(?<![\p{L}])(?:اأجر|أأجر|اأجرها|أأجرها|أأجره|هأجر|للإيجار|للايجار|rent)(?![\p{L}])/iu;

const MINE_TYPES = [
  [/شقتي|شقتى|my (?:flat|apartment)/iu, "شقة"],
  [/فيلتي|my villa/iu, "فيلا"],
  [/شاليهي/u, "شاليه"],
  [/محلي/u, "محل"],
  [/مكتبي/u, "مكتب"],
  [/عيادتي/u, "عيادة"],
  [/ارضي|أرضي/u, "أرض"],
  [/عمارتي/u, "عمارة"],
];
/** "شقتي" says the type even when "شقة" isn't written. */
const typeOfMine = (text) => MINE_TYPES.find(([r]) => r.test(text))?.[1] || null;

/** Does a short message say the writer wants to sell or rent out their own property? */
function isSellerIntent(text) {
  const t = String(text || "").trim();
  if (t.length < 6 || t.length > 300 || t.split("\n").length > 4) return false;
  return SELL_VERB.test(t) || (MINE.test(t) && FOR_DEAL.test(t));
}

const store = (state) => state.store("sellers", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;
const list = (state, status = "new") => Object.values(store(state).data.items).filter((o) => o.status === status).sort((a, b) => b.updated - a.updated);
const photoDir = (config, id) => path.join(config.paths.data, "sellers", String(Number(id)));
const photoFile = (config, id, n) => path.join(photoDir(config, id), `${Number(n)}.jpg`);
const dropPhotos = (config, id) => fs.rmSync(photoDir(config, id), { recursive: true, force: true });

/** Photos kept for all waiting offers. */
const storedPhotos = (state) => list(state, "new").reduce((n, o) => n + (o.photos || 0), 0);

/** Waiting offers nobody touched for 30 days are dropped, with their photos. @returns {number} dropped */
function expire(state, config, now = Date.now()) {
  const old = list(state, "new").filter((o) => now - o.updated > EXPIRE_AFTER);
  for (const o of old) dropPhotos(config, o.id);
  if (old.length) store(state).update((d) => old.forEach((o) => Object.assign(d.items[o.id], { status: "expired", updated: now })));
  return old.length;
}

/** The open offer of this number (still collecting), or null. */
const openFor = (state, phone, now = Date.now()) => Object.values(store(state).data.items).find((o) => o.phone === phone && o.status === "new" && o.openUntil > now) || null;

/** "شقة للبيع · التجمع الخامس · 150 م² · 3 غرف · 3,200,000 جنيه" */
function summary(state, o) {
  const f = o.fields || {};
  const cur = re.agent(state).currency;
  return [`${f.type || "عقار"} لل${o.deal}`, f.location, f.size && `${re.group(f.size)} م²`, f.rooms && `${f.rooms} غرف`, f.price && re.money(f.price, cur)].filter(Boolean).join(" · ");
}

function upsert(state, { phone, name, deal, text }, now) {
  return store(state).update((d) => {
    let o = Object.values(d.items).find((x) => x.phone === phone && x.status === "new");
    if (!o) {
      const id = ++d.seq;
      o = d.items[id] = { id, phone, name, deal, text: "", fields: {}, photos: 0, at: now, status: "new" };
      // Bounded: the oldest handled offers go first.
      const done = Object.values(d.items).filter((x) => x.status !== "new").sort((a, b) => a.updated - b.updated);
      for (const x of done.slice(0, Math.max(0, Object.keys(d.items).length - MAX_KEPT))) delete d.items[x.id];
    }
    Object.assign(o, { name: o.name || name, deal: deal || o.deal, updated: now, openUntil: now + OPEN_FOR });
    if (text) {
      o.text = `${o.text ? `${o.text}\n` : ""}${text}`.slice(0, MAX_TEXT);
      // Each message read on its own (joined, one line's end runs into the next one's start); later ones win.
      const f = re.parseListingText(text);
      delete f.notes; // their chat is not the listing's public description
      delete f.owner; // the owner is the person writing
      if (!f.type && !o.fields.type) f.type = typeOfMine(text) || undefined;
      for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
      o.fields = { ...o.fields, ...f };
    }
    return { ...o };
  });
}

const flood = (state, phone) => limiterFor(state, "sellers-client", { max: 8, windowMs: 10 * 60 * 1000 })(phone);
const newOffers = (state) => limiterFor(state, "sellers-new", { max: 20, windowMs: 3600 * 1000, size: 1 })("all");
const ASK = (a) =>
  [
    "أهلاً 👋 تمام، نقدر نسوّق عقارك.",
    "ابعتلي في رسالة: النوع، المنطقة، المساحة، عدد الغرف، الدور، التشطيب، والسعر المطلوب — ومعاها صور لو موجودة 📸",
    a.name ? `\n${a.name}${a.company ? ` — ${a.company}` : ""}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");

/**
 * A private message from someone who isn't staff. @returns {Promise<boolean>} true if it was
 * taken as part of an offer
 */
async function handle(ctx, now = Date.now()) {
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  if (!phone) return false; // the agent needs a number to call back
  const text = ctx.body.trim();
  const open = openFor(ctx.state, phone, now);
  const owner = `${ctx.config.owners.numbers[0]}@s.whatsapp.net`;
  const a = re.agent(ctx.state);

  // A photo while collecting: kept with the offer.
  const media = open && ctx.findMedia({ types: ["image"], quoted: false });
  if (media) {
    if (!flood(ctx.state, phone)) return true;
    if (open.photos >= MAX_PHOTOS) return true;
    if (storedPhotos(ctx.state) >= MAX_STORED_PHOTOS) return true; // the agent has enough to look at already
    const jpeg = await img.toListingJpeg(await ctx.download(media, 15 * 1024 * 1024));
    const n = open.photos + 1; // taken before the update: `open` is the stored object itself
    fs.mkdirSync(photoDir(ctx.config, open.id), { recursive: true, mode: 0o700 });
    fs.writeFileSync(photoFile(ctx.config, open.id, n), jpeg);
    store(ctx.state).update((d) => Object.assign(d.items[open.id], { photos: n, updated: now, openUntil: now + OPEN_FOR }));
    if (n === 1) await ctx.reply("📸 وصلت، ابعت باقي الصور والتفاصيل براحتك.");
    if (text) upsert(ctx.state, { phone, text }, now); // a caption is details too
    return true;
  }
  if (!text) return false;

  if (isSellerIntent(text)) {
    if (!flood(ctx.state, phone)) return true;
    if (!open) {
      expire(ctx.state, ctx.config, now);
      if (!newOffers(ctx.state)) return false; // a burst of new numbers: not collected
      if (list(ctx.state, "new").length >= MAX_OPEN && !list(ctx.state, "new").some((o) => o.phone === phone)) return false; // too many waiting: not collected
    }
    const o = upsert(ctx.state, { phone, name: (ctx.senderName || "").slice(0, 60) || undefined, deal: RENT.test(text) ? "إيجار" : "بيع", text }, now);
    await ctx.reply(ASK(a));
    if (!open) {
      await ctx.sock
        .sendMessage(owner, { text: `🏷️ *مالك عايز ${o.deal === "إيجار" ? "يأجّر" : "يبيع"}*: ${o.name || "—"} (+${phone})\n"${text.slice(0, 200)}"\nالتفاصيل والصور بتتجمع في: ${ctx.prefix}sellers ${o.id}\nhttps://wa.me/${phone}` })
        .catch(() => {});
    }
    return true;
  }

  if (open) {
    if (!flood(ctx.state, phone)) return true;
    const o = upsert(ctx.state, { phone, text }, now);
    if (!o.thanked) {
      store(ctx.state).update((d) => (d.items[o.id].thanked = true));
      await ctx.reply(`✅ تمام، وصلتني التفاصيل. ${a.name || "هنراجعها"}${a.name ? " هيراجعها" : ""} ويتواصل معاك قريب 🙏`);
      await ctx.sock.sendMessage(owner, { text: `🏷️ تفاصيل عرض المالك #${o.id} (+${phone}):\n${summary(ctx.state, o)}\n\nأضفه للكتالوج: ${ctx.prefix}sellers add ${o.id} · التفاصيل: ${ctx.prefix}sellers ${o.id}` }).catch(() => {});
    }
    return true;
  }
  return false;
}

/** The agent adds an offer to the catalogue: a listing with the person as its private owner, and their photos. */
function toListing(state, config, id, extraText, by) {
  const o = get(state, id);
  if (!o || o.status !== "new") throw new UserError(`There is no open offer #${id} (.sellers).`);
  const extra = extraText ? re.parseListingText(extraText) : {};
  const fields = { ...o.fields, ...extra, deal: extra.deal || o.fields.deal || o.deal };
  delete fields.owner;
  if (!fields.type) throw new UserError(`What kind of property is it? .sellers add ${id} النوع: شقة (or any other missing details).`);
  const l = re.add(state, { ...fields, owner: { name: o.name || undefined, phone: o.phone } }, by);
  for (let n = 1; n <= o.photos; n++) {
    const file = photoFile(config, id, n);
    if (fs.existsSync(file)) re.addPhoto(state, config, l.id, fs.readFileSync(file));
  }
  dropPhotos(config, id);
  store(state).update((d) => Object.assign(d.items[id], { status: "added", listing: l.id, updated: Date.now() }));
  return re.get(state, l.id);
}

function dismiss(state, config, id) {
  const o = get(state, id);
  if (!o || o.status !== "new") throw new UserError(`There is no open offer #${id} (.sellers).`);
  dropPhotos(config, id);
  store(state).update((d) => Object.assign(d.items[id], { status: "dismissed", updated: Date.now() }));
  return o;
}

module.exports = { handle, isSellerIntent, get, list, summary, toListing, dismiss, expire, storedPhotos, photoFile, OPEN_FOR, MAX_OPEN, MAX_STORED_PHOTOS, EXPIRE_AFTER };
