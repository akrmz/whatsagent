"use strict";

const re = require("./realestate");
const calc = require("./recalc");
const english = require("./english");
const { UserError } = require("../core/errors");

/**
 * Developers' projects sold off-plan (.project): a compound with its developer, area, unit
 * types and sizes, the starting price, and the payment plan (down payment %, years), delivery
 * and maintenance. Shown as "P3" to tell them apart from resale listings ("#12").
 *   DATA_DIR/projects.json { seq, items: { [id]: project } }
 */

const MAX_PROJECTS = 500;

const store = (state) => state.store("projects", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => (a.price || Infinity) - (b.price || Infinity));

const LABELS = {
  name: ["المشروع", "مشروع", "الكمبوند", "كمبوند", "الاسم", "project", "compound", "name"],
  developer: ["المطور", "مطور", "الشركة", "المطور العقاري", "developer"],
  location: ["المنطقة", "منطقة", "الموقع", "المكان", "location", "area"],
  units: ["الوحدات", "وحدات", "الأنواع", "الانواع", "المساحات", "units", "types"],
  price: ["يبدأ من", "تبدأ من", "الأسعار", "الاسعار", "السعر", "سعر", "من", "price", "from", "starting"],
  down: ["المقدم", "مقدم", "down", "down payment"],
  years: ["التقسيط", "تقسيط", "السنوات", "سنوات التقسيط", "مدة التقسيط", "installments", "years"],
  delivery: ["الاستلام", "استلام", "التسليم", "تسليم", "delivery"],
  maint: ["الصيانة", "صيانة", "وديعة الصيانة", "maintenance"],
  notes: ["ملاحظات", "مميزات", "المميزات", "notes", "features"],
};
const LABEL_OF = new Map(Object.entries(LABELS).flatMap(([k, words]) => words.map((w) => [w.toLowerCase(), k])));

const READY = /(?<![\p{L}])(?:فوري|فورى|جاهز|جاهزة|ready|immediate)(?![\p{L}])/iu;
const pct = (v) => {
  if (/بدون|without|zero/i.test(v)) return 0;
  const n = Number(re.latinDigits(v).match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
};
/** "8 سنوات" → 8, "96 شهر" → 8 */
const yearsOf = (v) => {
  const m = re.latinDigits(v).match(/(\d{1,3})\s*(شهر|شهور|أشهر|اشهر|months?)?/i);
  if (!m) return undefined;
  const y = m[2] ? Number(m[1]) / 12 : Number(m[1]);
  return y >= 1 && y <= 15 ? Math.round(y * 10) / 10 : undefined;
};
/** Unit sizes written with the units: "شقق من 120 لـ 200 م" → [120, 200] */
const sizesIn = (text) => {
  const ns = [...re.latinDigits(String(text || "")).matchAll(/(?<![\d.])(\d{2,4})(?![\d.])/g)].map((m) => Number(m[1])).filter((n) => n >= 30 && n <= 3000);
  return ns.length ? [Math.min(...ns), Math.max(...ns)] : null;
};

/** "label: value" lines → the fields written (unknown lines go to the notes). */
function parseProjectText(text) {
  const out = {};
  const notes = [];
  for (const raw of String(text || "").split(/\n+/)) {
    const line = raw.replace(/^(?:[\s•▪◾🔹🔸*\-–—✅📍💰🏗🏢🏠💳🔑🛠📝]|️)+/u, "").trim();
    if (!line) continue;
    const m = line.match(/^([^:：]{1,25})\s*[:：]\s*(.+)$/);
    const key = m && LABEL_OF.get(m[1].trim().toLowerCase());
    if (!key) {
      notes.push(line);
      continue;
    }
    const v = m[2].trim();
    if (key === "name" || key === "developer") out[key] = v.slice(0, 60);
    else if (key === "location") out.location = v.slice(0, 80);
    else if (key === "units") out.units = v.slice(0, 160);
    else if (key === "price") out.price = re.parseAmount(v) || undefined;
    else if (key === "down") out.down = pct(v);
    else if (key === "years") out.years = yearsOf(v);
    else if (key === "maint") out.maint = pct(v);
    else if (key === "delivery") {
      out.delivery = v.slice(0, 40);
      out.ready = READY.test(v) || undefined;
      out.deliveryYear = Number(re.latinDigits(v).match(/\b(20\d{2})\b/)?.[1]) || undefined;
    } else if (key === "notes") notes.push(v);
  }
  if (notes.length) out.notes = notes.join("\n").slice(0, 500);
  const types = re.typesIn(`${out.units || ""} ${out.name || ""}`);
  if (types.length) out.types = types;
  const sizes = sizesIn(out.units);
  if (sizes) out.sizes = sizes;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

const USAGE =
  "Write it as lines, e.g.\n.project add\nالمشروع: ماونتن فيو آي سيتي\nالمطور: ماونتن فيو\nالمنطقة: التجمع الخامس\nالوحدات: شقق من 120 لـ 200 م، تاون هاوس، فيلات\nيبدأ من: 6.5 مليون\nالمقدم: 10%\nالتقسيط: 8 سنوات\nالاستلام: 2028\nالصيانة: 8%";

function add(state, fields, by, now = Date.now()) {
  if (!fields.name) throw new UserError(`What's the project's name (المشروع)?\n${USAGE}`);
  return store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_PROJECTS) throw new UserError(`You have ${MAX_PROJECTS} projects saved. Delete old ones first.`);
    const id = ++d.seq;
    d.items[id] = { id, ...fields, by, created: now, updated: now };
    return d.items[id];
  });
}

function update(state, id, changes, now = Date.now()) {
  return store(state).update((d) => {
    const p = d.items[id];
    if (!p) throw new UserError(`There is no project P${id}.`);
    Object.assign(p, changes, { updated: now });
    return p;
  });
}

const remove = (state, id) =>
  store(state).update((d) => {
    const p = d.items[id];
    if (!p) throw new UserError(`There is no project P${id}.`);
    delete d.items[id];
    return p;
  });

/** The instalment for the cheapest unit, when the plan is known (quarterly, as developers quote). */
function example(p) {
  if (!p.price || p.down === undefined || !p.years || !Number.isInteger(p.years)) return null;
  try {
    return calc.installments(`${p.price} ${p.down}% ${p.years} quarterly${p.maint ? ` maint ${p.maint}%` : ""}`);
  } catch {
    return null;
  }
}

const planText = (p) => [p.down !== undefined && (p.down === 0 ? "بدون مقدم" : `مقدم ${p.down}%`), p.years && `${p.years} سنين`, p.ready ? "استلام فوري" : p.delivery && `استلام ${p.delivery}`].filter(Boolean).join(" · ");

const line = (p, cur) => `*P${p.id}* ${p.name}${p.location ? ` — ${p.location.slice(0, 30)}` : ""}${p.price ? ` — يبدأ ${re.shortAr(p.price)}${cur ? ` ${cur}` : ""}` : ""}${planText(p) ? ` · ${planText(p)}` : ""}`;

function card(p, a) {
  const cur = a.currency || "جنيه";
  const ex = example(p);
  return [
    `🏗️ *${p.name}* — P${p.id}`,
    p.developer && `🏢 المطور: ${p.developer}`,
    p.location && `📍 ${p.location}`,
    p.units && `🏠 الوحدات: ${p.units}`,
    p.price && `💰 يبدأ من: *${re.money(p.price, cur)}* (${re.shortAr(p.price)})`,
    planText(p) && `💳 ${planText(p)}`,
    ex && `   ≈ ${re.money(ex.each, cur)} ربع سنوي (≈ ${re.money((ex.each * 4) / 12, cur)} شهرياً) بعد مقدم ${re.money(ex.down, cur)} — لأقل وحدة`,
    p.maint !== undefined && `🛠️ الصيانة: ${p.maint}%`,
    p.notes && `📝 ${p.notes}`,
    `\nللاستفسار أرسل: P${p.id}`,
    re.contactLine(a) && `\n${re.contactLine(a)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The English card (P3 en, .project 3 en): fixed words translated, known areas in English. */
function cardEn(p, a) {
  const cur = english.currencyEn(a.currency);
  const money = (n) => `${cur} ${re.group(Math.round(n))}`;
  const ex = example(p);
  const units = (p.types || []).map((t) => (t === "أرض" ? "Land" : `${english.typeEn(t)}s`)).join(", ");
  const sizes = p.sizes ? `${p.sizes[0]}–${p.sizes[1]} m²` : "";
  const plan = [p.down !== undefined && (p.down === 0 ? "No down payment" : `${p.down}% down`), p.years && `${p.years} years`, p.ready ? "Ready to move in" : p.deliveryYear && `Delivery ${p.deliveryYear}`].filter(Boolean).join(" · ");
  const contact = [a.name && `👤 ${a.name}`, a.phone && `📞 ${a.phone}`, a.company && `🏢 ${a.company}`].filter(Boolean).join(" · ");
  return [
    `🏗️ *${p.name}* — P${p.id}`,
    p.developer && `🏢 Developer: ${p.developer}`,
    p.location && `📍 ${english.locationEn({ location: p.location }) || p.location}`,
    (units || sizes) && `🏠 Units: ${[units, sizes].filter(Boolean).join(" · ")}`,
    p.price && `💰 From *${money(p.price)}* (${cur} ${+(p.price / 1e6).toFixed(2)}M)`,
    plan && `💳 ${plan}`,
    ex && `   ≈ ${money(ex.each)} quarterly (≈ ${money((ex.each * 4) / 12)} / month) after ${money(ex.down)} down — smallest unit`,
    p.maint !== undefined && `🛠️ Maintenance: ${p.maint}%`,
    `\nTo ask about it, send: P${p.id} en`,
    contact && `\n${contact}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const GENERIC = new Set(["كمبوند", "compound", "مدينة", "city", "مشروع", "project", "الجديدة", "new"]);
const placeWords = (s) =>
  re
    .latinDigits(String(s || ""))
    .toLowerCase()
    .split(/[\s,،\-–/]+/)
    .map((w) => w.replace(/^ال/u, ""))
    .filter((w) => w.length > 2 && !GENERIC.has(w));

/**
 * Does a project suit what a client wants (a lead or a request: type, deal, location, budget)?
 * Projects are for sale, so a client who wants to rent never matches.
 */
function suits(p, w) {
  if (w.deal === "إيجار") return false;
  if (!w.type && !w.location && !w.max) return false;
  if (w.type && p.types?.length && !p.types.includes(w.type)) return false;
  if (w.max && p.price && p.price > w.max * 1.1) return false;
  const words = placeWords(w.location);
  if (words.length) {
    const where = placeWords(`${p.location || ""} ${p.name || ""}`);
    if (!words.some((x) => where.some((y) => y.includes(x) || x.includes(y)))) return false;
  }
  return true;
}
const forWish = (state, w) => all(state).filter((p) => suits(p, w));

/** ".projects التجمع حتى 8 مليون مقدم 10% 8 سنين فوري" */
function search(state, query) {
  let q = re.latinDigits(String(query || "")).toLowerCase();
  const f = {};
  let m;
  if ((m = q.match(/(?:مقدم|down)\s*(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s*(?:مقدم|down)/))) {
    f.down = Number(m[1] ?? m[2]);
    q = q.replace(m[0], " ");
  }
  if ((m = q.match(/(\d{1,2})\s*(?:سنين|سنوات|سنة|سنه|years?)/))) {
    f.years = Number(m[1]);
    q = q.replace(m[0], " ");
  }
  if ((m = q.match(/(?:حتى|لحد|<|أقل من|اقل من|budget)\s*(\d+(?:\.\d+)?)\s*(m|مليون|k|ألف|الف)?/))) {
    f.max = Number(m[1]) * (/^(m|مليون)$/.test(m[2] || "") ? 1e6 : m[2] ? 1e3 : 1);
    q = q.replace(m[0], " ");
  }
  if (READY.test(q)) {
    f.ready = true;
    q = q.replace(new RegExp(READY.source, "giu"), " ").replace(/استلام/g, " ");
  }
  f.type = re.typeIn(q);
  if (f.type) q = re.stripTypeWords(q);
  const words = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
  const year = new Date().getFullYear();
  const list = all(state).filter((p) => {
    if (f.down !== undefined && !(p.down !== undefined && p.down <= f.down)) return false;
    if (f.years && !(p.years >= f.years)) return false;
    if (f.max && !(p.price && p.price <= f.max)) return false;
    if (f.ready && !(p.ready || (p.deliveryYear && p.deliveryYear <= year))) return false;
    if (f.type && p.types?.length && !p.types.includes(f.type)) return false;
    const where = `${p.name} ${p.developer || ""} ${p.location || ""}`.toLowerCase();
    return words.every((w) => where.includes(w) || where.includes(w.replace(/^ال/u, "")));
  });
  return { list, filters: f, words };
}

module.exports = { get, all, add, update, remove, parseProjectText, sizesIn, example, card, cardEn, line, planText, suits, forWish, search, USAGE };
