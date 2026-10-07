"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UserError } = require("../core/errors");

/**
 * Real-estate tools: the agent's profile, a catalogue of listings with photos, and the
 * text parsing/formatting they share.
 *   DATA_DIR/realestate-agent.json  { name, phone, company, currency }
 *   DATA_DIR/listings.json          { seq, items: { [id]: listing } }
 *   DATA_DIR/listings/<id>/<n>.jpg  photos (not part of .backup, which holds JSON only)
 */

const MAX_LISTINGS = 1000;
const MAX_PHOTOS = 10;

// ---- numbers ----------------------------------------------------------------------------

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/٫/g, ".").replace(/[٬،]/g, ",");

/** "3,500,000", "3.5 مليون", "3.5m", "750 ألف", "750k" → 3500000 / 750000; null if none. */
function parseAmount(text) {
  const s = latinDigits(text).toLowerCase();
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(مليون|ملايين|million|mil|m\b|ألف|الف|آلاف|الاف|thousand|k\b)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (/^(مليون|ملايين|million|mil|m)$/.test(m[2] || "")) n *= 1e6;
  else if (m[2]) n *= 1e3;
  return Number.isFinite(n) ? Math.round(n) : null;
}

const firstNumber = (text) => {
  const m = latinDigits(text).match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const group = (n) => Math.round(n).toLocaleString("en-US");
/** 3500000 → "3.5 مليون", 750000 → "750 ألف" */
function shortAr(n) {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(2))} مليون`;
  if (n >= 1e3) return `${Number((n / 1e3).toFixed(1))} ألف`;
  return group(n);
}
const money = (n, currency) => `${group(n)} ${currency}`;

// ---- the agent's profile ----------------------------------------------------------------

const agentStore = (state) => state.store("realestate-agent", { currency: "جنيه" });
const agent = (state) => ({ currency: "جنيه", ...agentStore(state).data });

const AGENT_FIELDS = { name: 60, phone: 30, company: 60, currency: 12 };
function setAgent(state, field, value) {
  if (field === "autoleads") {
    const v = String(value || "").trim().toLowerCase();
    if (!["on", "off"].includes(v)) throw new UserError("autoleads on | off");
    return agentStore(state).update((d) => {
      if (v === "on") d.autoleads = true;
      else delete d.autoleads;
      return { ...d };
    });
  }
  if (!(field in AGENT_FIELDS)) throw new UserError(`Fields: ${Object.keys(AGENT_FIELDS).join(", ")}, autoleads`);
  const v = String(value || "").trim().slice(0, AGENT_FIELDS[field]);
  return agentStore(state).update((d) => {
    if (v) d[field] = v;
    else delete d[field];
    return { ...d };
  });
}
const contactLine = (a) => [a.name && `👤 ${a.name}`, a.phone && `📞 ${a.phone}`, a.company && `🏢 ${a.company}`].filter(Boolean).join(" · ");

// ---- reading a property description -----------------------------------------------------

const TYPES = [
  ["شقة", ["شقة", "شقه", "apartment", "flat"]],
  ["فيلا", ["فيلا", "فيلة", "villa"]],
  ["دوبلكس", ["دوبلكس", "duplex"]],
  ["بنتهاوس", ["بنتهاوس", "penthouse"]],
  ["تاون هاوس", ["تاون هاوس", "تاون", "townhouse", "town house"]],
  ["توين هاوس", ["توين هاوس", "توين", "twin house", "twinhouse"]],
  ["شاليه", ["شاليه", "chalet"]],
  ["استوديو", ["استوديو", "ستوديو", "studio"]],
  ["محل", ["محل", "shop", "store"]],
  ["مكتب", ["مكتب", "office"]],
  ["عيادة", ["عيادة", "عياده", "clinic"]],
  ["أرض", ["أرض", "ارض", "land", "plot"]],
  ["عمارة", ["عمارة", "عماره", "building"]],
];
const DEALS = [
  ["بيع", ["بيع", "sale", "for sale", "sell", "selling"]],
  ["إيجار", ["إيجار", "ايجار", "rent", "for rent", "rental", "lease"]],
];

/**
 * A whole word, with the prefixes Arabic attaches to it: و/ف/ب/ك (and, so, with, like) and
 * ال/لل/ل (the, for the). So "للبيع", "الشقة", "وفيلا" match, but "الربيع" (a district) is
 * not "بيع", "المحلة" is not "محل" and "الأرضي" (ground floor) is not "أرض".
 */
const wordRe = (word, flags = "iu") => new RegExp(`(?<![\\p{L}\\p{N}])(?:[وفبك])?(?:ال|لل|ل)?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, flags);
const TYPE_RES = TYPES.map(([type, words]) => [type, words.map((w) => wordRe(w))]);
const DEAL_RES = DEALS.map(([deal, words]) => [deal, words.map((w) => wordRe(w))]);
const ALL_RE = /(?<![\p{L}\p{N}])(?:all|الكل|كل)(?![\p{L}\p{N}])/giu;
const LABELS = {
  type: ["النوع", "نوع", "نوع العقار", "العقار", "type", "property"],
  deal: ["الغرض", "الغرض من", "نوع العرض", "deal", "for", "purpose"],
  location: ["المنطقة", "منطقة", "الموقع", "موقع", "العنوان", "عنوان", "المكان", "الكمبوند", "كمبوند", "location", "address", "city", "compound"],
  price: ["السعر", "سعر", "المطلوب", "price"],
  size: ["المساحة", "مساحة", "المساحه", "size", "area", "sqm", "m2"],
  rooms: ["الغرف", "غرف", "عدد الغرف", "غرف النوم", "rooms", "bedrooms", "beds"],
  baths: ["الحمامات", "حمامات", "حمام", "عدد الحمامات", "baths", "bathrooms"],
  floor: ["الدور", "دور", "الطابق", "طابق", "floor"],
  finishing: ["التشطيب", "تشطيب", "finishing"],
  notes: ["ملاحظات", "تفاصيل", "مميزات", "الوصف", "وصف", "notes", "details", "features", "description"],
};
const LABEL_OF = new Map(Object.entries(LABELS).flatMap(([k, words]) => words.map((w) => [w.toLowerCase(), k])));

const typeIn = (text) => TYPE_RES.find(([, res]) => res.some((r) => r.test(String(text))))?.[0] || null;
const dealIn = (text) => DEAL_RES.find(([, res]) => res.some((r) => r.test(String(text))))?.[0] || null;

const FINISHING = ["ألترا سوبر لوكس", "الترا سوبر لوكس", "سوبر لوكس", "نص تشطيب", "نصف تشطيب", "على المحارة", "علي المحارة", "تشطيب كامل", "متشطب", "بدون تشطيب", "لوكس", "fully finished", "semi finished", "core and shell"];
const ARABIC_COUNTS = { غرفتين: ["rooms", 2], غرفتان: ["rooms", 2], أوضتين: ["rooms", 2], اوضتين: ["rooms", 2], حمامين: ["baths", 2], حمامان: ["baths", 2] };
// Words that end a location written in a sentence ("في التجمع الخامس 150 متر …").
const LOCATION_STOP = /\s(?:\d|مساحة|مساحه|متر|بسعر|سعر|السعر|غرف|غرفة|اوض|أوض|حمام|دور|الدور|تشطيب|للبيع|للإيجار|للايجار|بمقدم|مقدم|استلام|فيو|بجوار|قريب|في حدود|حدود|ميزانية|ميزانيه|بميزانية|لحد|حتى|عايز|عاوز|budget|for\s)|[،,.!؟\n(]/u;

/**
 * Details written as a sentence, the way most broker posts are:
 * "شقة للبيع في التجمع الخامس 150 متر 3 غرف 2 حمام الدور الرابع سوبر لوكس بسعر 3.5 مليون".
 * Amounts next to مقدم/قسط (down payment, instalment) are not taken as the price.
 * @returns {object} the fields found
 */
function extractFree(text) {
  const t = latinDigits(String(text || "")).replace(/\s+/g, " ");
  const out = {};
  let m;
  if ((m = t.match(/(\d{2,5}(?:\.\d+)?)\s*(?:م²|م2|متر(?:\s*مربع)?|م(?![\p{L}])|sqm|m2|m²|sq\s?m)/iu))) out.size = Number(m[1]);
  if ((m = t.match(/(\d{1,2})\s*(?:غرف|غرفة|غرفه|غرفات|أوض|اوض|أوضة|اوضة|اوضه|bed(?:room)?s?|br\b|rooms?\b)/iu))) out.rooms = Number(m[1]);
  if ((m = t.match(/(\d{1,2})\s*(?:حمام|حمامات|bath(?:room)?s?\b)/iu))) out.baths = Number(m[1]);
  // "غرفتين" / "وحمامين" (with "and" attached) are counts too.
  for (const [word, [field, n]] of Object.entries(ARABIC_COUNTS)) if (out[field] === undefined && new RegExp(`(?<![\\p{L}])[وب]?${word}(?![\\p{L}])`, "u").test(t)) out[field] = n;
  if ((m = t.match(/(?:الدور|دور|الطابق|طابق)\s+(ال[\p{L}]+|\d{1,2}|أرضي|ارضي|أخير|اخير)/u))) out.floor = m[1];
  const fin = FINISHING.find((f) => new RegExp(`(?<![\\p{L}])${f}(?![\\p{L}])`, "iu").test(t));
  if (fin) out.finishing = fin;
  // The price: after a price word, else the first amount in millions/thousands that isn't a down payment or instalment.
  const amount = String.raw`(\d[\d,]*(?:\.\d+)?\s*(?:مليون|ملايين|million|m\b|ألف|الف|k\b)?)`;
  if ((m = t.match(new RegExp(`(?:بسعر|السعر|سعر|المطلوب|price|بـ)\\s*:?\\s*${amount}`, "iu")))) out.price = parseAmount(m[1]) || undefined;
  if (!out.price) {
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(مليون|ملايين|million|ألف|الف)/gu;
    while ((m = re.exec(t))) {
      if (/(مقدم|قسط|اقساط|أقساط|down|installment|وديعة|صيانة)\s*$/u.test(t.slice(Math.max(0, m.index - 15), m.index))) continue;
      out.price = parseAmount(m[0]);
      break;
    }
  }
  if ((m = t.match(/(?:^|\s)(?:في|بـ?منطقة|منطقة|بكمبوند|كمبوند|بمدينة|in)\s+(.{3,60})/u))) {
    const loc = m[1].split(LOCATION_STOP)[0].trim();
    if (loc.length >= 3 && !/^\d/.test(loc)) out.location = loc;
  }
  for (const k of Object.keys(out)) if (out[k] === undefined || Number.isNaN(out[k])) delete out[k];
  return out;
}

/**
 * Reads a description written as "label: value" lines (Arabic or English labels), the way
 * listings are usually posted; unlabeled lines go to the notes, and the type and sale/rent
 * are also recognised anywhere in the text.
 * @returns {object} the fields found (only those)
 */
function parseListingText(text) {
  const out = {};
  const notes = [];
  for (const raw of String(text || "").split(/\n+/)) {
    // Bullets and emoji people start lines with ("📍 المنطقة: …"), including the U+FE0F variant selector.
    const line = raw.replace(/^(?:[\s•▪◾🔹🔸*\-–—✅📍💰📐🛏🛁🏢✨📝]|️)+/u, "").trim();
    if (!line) continue;
    const m = line.match(/^([^:：]{1,25})\s*[:：]\s*(.+)$/);
    const key = m && LABEL_OF.get(m[1].trim().toLowerCase().replace(/\s+/g, " "));
    if (!key) {
      notes.push(line);
      continue;
    }
    const value = m[2].trim();
    if (key === "type") out.type = typeIn(value) || value.slice(0, 30);
    else if (key === "deal") out.deal = dealIn(value) || out.deal;
    else if (key === "price") out.price = parseAmount(value) ?? out.price;
    else if (key === "size") out.size = firstNumber(value) ?? out.size;
    else if (key === "rooms" || key === "baths") out[key] = firstNumber(value) ?? out[key];
    else if (key === "notes") notes.push(value);
    else out[key] = value.slice(0, key === "location" ? 120 : 60);
  }
  const all = String(text || "");
  out.type ||= typeIn(all.split("\n")[0]) || typeIn(all) || undefined;
  out.deal ||= dealIn(all) || undefined;
  // Details written as sentences in the unlabeled lines fill what the labels didn't give.
  for (const [k, v] of Object.entries(extractFree(notes.join("\n")))) if (out[k] === undefined) out[k] = v;
  if (notes.length) {
    // Lines that only repeated the type or deal ("شقة للبيع") aren't notes.
    const rest = notes.filter((l) => !(l.length < 40 && (typeIn(l) || dealIn(l)) && !/\d/.test(l)));
    if (rest.length) out.notes = rest.join("\n").slice(0, 600);
  }
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === null) delete out[k];
  return out;
}

/**
 * Fields from an outside source (the AI's JSON answer), checked before they are saved: known
 * types and deals only, numbers in sensible ranges, strings shortened. Anything else is dropped.
 */
function cleanFields(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const num = (v, min, max) => {
    const n = typeof v === "number" ? v : parseAmount(String(v ?? ""));
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : undefined;
  };
  const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const out = {
    type: typeIn(String(r.type || "")) || undefined,
    deal: dealIn(String(r.deal || "")) || ({ sale: "بيع", rent: "إيجار" }[String(r.deal || "").toLowerCase()] ?? undefined),
    location: str(r.location, 120),
    price: num(r.price, 1000, 1e10),
    size: num(r.size, 10, 100000),
    rooms: num(r.rooms, 0, 50),
    baths: num(r.baths, 0, 50),
    floor: str(typeof r.floor === "number" ? String(r.floor) : r.floor, 20),
    finishing: str(r.finishing, 40),
    notes: str(r.notes, 600),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// ---- the catalogue ----------------------------------------------------------------------

const store = (state) => state.store("listings", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => b.id - a.id);
const STATUS_AR = { available: "✅ متاح", reserved: "⏳ محجوز", sold: "🔴 تم البيع", rented: "🔴 تم التأجير" };

function add(state, fields, by, now = Date.now()) {
  if (!fields.type && !fields.price && !fields.location) throw new UserError("I couldn't read the property. Write it as lines like:\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.5 مليون\nالمساحة: 150\nالغرف: 3");
  return store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_LISTINGS) throw new UserError(`The catalogue is full (${MAX_LISTINGS}). Delete old listings first.`);
    const id = ++d.seq;
    d.items[id] = { id, deal: "بيع", ...fields, photos: 0, status: "available", by, created: now, updated: now };
    return d.items[id];
  });
}

/** A saved listing that looks like the same property (same type, deal, price, size and location). */
function findDuplicate(state, f) {
  if (!f.price || !f.location) return null;
  const norm = (s) => latinDigits(String(s || "")).toLowerCase().replace(/[ً-ٰٟ]/g, "").replace(/[\s\-–,،]+/g, " ").trim();
  return (
    Object.values(store(state).data.items).find(
      (l) => l.price === f.price && (l.type || null) === (f.type || null) && (l.deal || "بيع") === (f.deal || "بيع") && (l.size || null) === (f.size || null) && norm(l.location) === norm(f.location),
    ) || null
  );
}

function update(state, id, changes, now = Date.now()) {
  return store(state).update((d) => {
    const l = d.items[id];
    if (!l) throw new UserError(`There is no listing #${id}.`);
    // Price history (the last 10 earlier prices), for "📉 was … — x% off".
    if (changes.price && l.price && changes.price !== l.price) l.priceHistory = [...(l.priceHistory || []), { price: l.price, at: now }].slice(-10);
    Object.assign(l, changes, { updated: now });
    return l;
  });
}

const DISCOUNT_DAYS = 30;

/** A price cut within the last 30 days: { was, pct }, or null. */
function discount(l, now = Date.now()) {
  const last = l.priceHistory?.at(-1);
  if (!last || !l.price || last.price <= l.price || now - last.at > DISCOUNT_DAYS * 86400000) return null;
  return { was: last.price, pct: Math.round((1 - l.price / last.price) * 100) };
}

/** Interest counters (views, inquiries, sent, posted); they don't change "updated". */
function count(state, id, field) {
  store(state).update((d) => {
    const l = d.items[id];
    if (!l) return;
    l.stats ||= {};
    l.stats[field] = (l.stats[field] || 0) + 1;
  });
}

/** Available listings not updated for `days` days, oldest first. */
const stale = (state, days = 30, now = Date.now()) =>
  all(state)
    .filter((l) => l.status === "available" && now - (l.updated || l.created) > days * 86400000)
    .sort((a, b) => (a.updated || a.created) - (b.updated || b.created));

const photosDir = (config, id) => path.join(config.paths.data, "listings", String(id));
const photoPath = (config, id, n) => path.join(photosDir(config, id), `${n}.jpg`);

/** Saves a photo (already a JPEG) as the next one of the listing. @returns {number} its number */
function addPhoto(state, config, id, jpeg) {
  const l = get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  if (l.photos >= MAX_PHOTOS) throw new UserError(`A listing can have ${MAX_PHOTOS} photos.`);
  fs.mkdirSync(photosDir(config, id), { recursive: true, mode: 0o700 });
  const n = l.photos + 1;
  fs.writeFileSync(photoPath(config, id, n), jpeg);
  update(state, id, { photos: n });
  return n;
}

const photos = (config, l) =>
  Array.from({ length: l.photos || 0 }, (_, i) => photoPath(config, l.id, i + 1)).filter((p) => fs.existsSync(p));

function remove(state, config, id) {
  const l = get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  store(state).update((d) => delete d.items[id]);
  fs.rmSync(photosDir(config, id), { recursive: true, force: true });
  return l;
}

/** The listing as a WhatsApp message. */
function card(l, a) {
  const cur = a.currency || "جنيه";
  const specs = [l.size && `📐 ${group(l.size)} م²`, l.rooms && `🛏 ${l.rooms} غرف`, l.baths && `🛁 ${l.baths} حمام`, l.floor && `🏢 الدور ${l.floor}`].filter(Boolean).join(" · ");
  const ppm = l.price && l.size && l.deal !== "إيجار" ? `💵 سعر المتر: ${money(l.price / l.size, cur)}` : null;
  const cut = discount(l);
  return [
    `🏠 *${l.type || "عقار"} لل${l.deal || "بيع"}* — #${l.id}`,
    l.location && `📍 ${l.location}`,
    l.price && `💰 *${money(l.price, cur)}*${l.price >= 1e5 ? ` (${shortAr(l.price)})` : ""}${l.deal === "إيجار" ? " شهرياً" : ""}`,
    cut && `📉 كان ${money(cut.was, cur)} — خصم ${cut.pct}%`,
    specs || null,
    l.finishing && `✨ التشطيب: ${l.finishing}`,
    ppm,
    l.notes && `📝 ${l.notes}`,
    `🔖 ${STATUS_AR[l.status] || l.status}`,
    contactLine(a) && `\n${contactLine(a)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * ".listings شقة التجمع 2m-4m 3 غرف للبيع" — filters, in any order:
 *   a type (شقة، فيلا …), بيع/إيجار, a price range "2m-4m" / "<3m" / ">1.5m",
 *   rooms "3 غرف" / "3br", "all" (also reserved and sold); the rest must appear in the location.
 */
function search(state, query) {
  let q = latinDigits(String(query || "")).toLowerCase();
  const f = { type: typeIn(q), deal: dealIn(q), all: new RegExp(ALL_RE.source, "iu").test(q) };
  q = q.replace(ALL_RE, " ");
  const amount = String.raw`(\d+(?:\.\d+)?)\s*(m|مليون|k|ألف|الف)?`;
  const toN = (n, u) => Number(n) * (/^(m|مليون)$/.test(u || "") ? 1e6 : u ? 1e3 : 1);
  let r;
  if ((r = q.match(new RegExp(`${amount}\\s*-\\s*${amount}`)))) {
    [f.min, f.max] = [toN(r[1], r[2] || r[4]), toN(r[3], r[4])];
    q = q.replace(r[0], " ");
  } else if ((r = q.match(new RegExp(`(<|>|اقل من|أقل من|حتى|اكثر من|أكثر من)\\s*${amount}`)))) {
    const n = toN(r[2], r[3]);
    if (/<|اقل|أقل|حتى/.test(r[1])) f.max = n;
    else f.min = n;
    q = q.replace(r[0], " ");
  }
  if ((r = q.match(/(\d{1,2})\s*(غرف|غرفة|br|bed|rooms?)/))) {
    f.rooms = Number(r[1]);
    q = q.replace(r[0], " ");
  }
  // Take out the type and deal words that were used as filters (whole words only, as above).
  for (const [, words] of [...TYPES, ...DEALS]) for (const w of words) q = q.replace(wordRe(w, "giu"), " ");
  const words = q.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
  const list = all(state).filter((l) => {
    if (!f.all && l.status !== "available") return false;
    if (f.type && l.type !== f.type) return false;
    if (f.deal && l.deal !== f.deal) return false;
    if (f.min && !(l.price >= f.min)) return false;
    if (f.max && !(l.price <= f.max)) return false;
    if (f.rooms && l.rooms !== f.rooms) return false;
    const where = `${l.location || ""} ${l.notes || ""}`.toLowerCase();
    return words.every((w) => where.includes(w));
  });
  return { filters: f, words, list };
}

const line = (l, cur) =>
  `*#${l.id}* ${l.type || "عقار"} لل${l.deal || "بيع"}${l.location ? ` — ${l.location.slice(0, 40)}` : ""}${l.price ? ` — ${shortAr(l.price)}${cur ? ` ${cur}` : ""}` : ""}${l.size ? ` · ${l.size}م²` : ""}${l.rooms ? ` · ${l.rooms} غرف` : ""}${l.status !== "available" ? ` (${STATUS_AR[l.status]})` : ""}${l.photos ? " 📷" : ""}`;

module.exports = {
  parseAmount, latinDigits, shortAr, money, group,
  agent, setAgent, contactLine,
  parseListingText, extractFree, cleanFields, typeIn, dealIn,
  add, update, get, all, remove, addPhoto, photos, photoPath, card, search, line, findDuplicate, discount, count, stale,
  STATUS_AR, MAX_PHOTOS,
};
