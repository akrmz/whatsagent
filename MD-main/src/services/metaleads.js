"use strict";

const re = require("./realestate");
const leads = require("./leads");
const { normalizePhone } = require("./phones");

/**
 * Leads downloaded from Facebook / Instagram lead ads (Meta's Leads Center or Ads Manager:
 * full_name, phone_number "p:+2010…", platform fb/ig, ad_name …, then one column per form
 * question). Each row becomes a client: source فيسبوك or إنستجرام, the ad's name as the
 * campaign, and the form's answers read where the question says what it asks, all kept in notes.
 */

const META_FIELDS = new Set([
  "id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name", "is_organic",
  "platform", "full_name", "first_name", "last_name", "phone_number", "phone", "email", "lead_status", "inbox_url", "is_qualified", "is_quality", "is_converted",
]);

/** Is this header a Meta lead export? */
const isMeta = (header) => header.includes("full_name") || (header.includes("phone_number") && ["ad_name", "form_name", "platform", "campaign_name"].some((h) => header.includes(h)));

/** Choice answers come as "2_-_3_مليون" or "شقة_3_غرف": back to spaces. */
const answer = (v) => String(v || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();

/** One exported row → the fields for leads.add. */
function fromMeta(row, ownerNumber) {
  const name = (row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ")).trim().slice(0, 60);
  const phone = normalizePhone(String(row.phone_number || row.phone || "").replace(/^p:/i, ""), ownerNumber);
  const fields = {
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    source: /^(ig|instagram)$/i.test(String(row.platform || "").trim()) ? "إنستجرام" : "فيسبوك",
  };
  const campaign = answer(row.ad_name || row.campaign_name || row.form_name).slice(0, 60);
  if (campaign) fields.campaign = campaign;
  const notes = [];
  const all = [];
  for (const [k, raw] of Object.entries(row)) {
    if (META_FIELDS.has(k)) continue;
    const v = answer(raw);
    if (!v) continue;
    const q = answer(k).replace(/[?؟:]+$/, "");
    all.push(v);
    notes.push(`${q}: ${v}`);
    if (/ميزاني|budget|السعر|سعر|price/i.test(q)) Object.assign(fields, leads.parseBudget(v));
    else if (/منطق|مكان|موقع|location|area|city|مدينة|حي/i.test(q)) fields.location = v.slice(0, 80);
    else if (/غرف|rooms|bedroom/i.test(q)) fields.rooms = Number(re.latinDigits(v).match(/\d+/)?.[0]) || undefined;
    else if (/نوع|type|unit|وحد/i.test(q)) fields.type = re.typeIn(v) || undefined;
    else if (/شراء|ايجار|إيجار|الغرض|buy|rent|purpose/i.test(q)) fields.deal = /ايجار|إيجار|rent/i.test(v) ? "إيجار" : /شراء|تمليك|buy|بيع/i.test(v) ? "بيع" : undefined;
  }
  // Wishes written in other answers ("عايز شقة في التجمع") fill what the questions didn't give.
  const free = leads.parseLeadText(all.join("\n"), ownerNumber);
  for (const k of ["type", "deal", "location", "rooms", "min", "max"]) if (fields[k] === undefined && free[k] !== undefined) fields[k] = free[k];
  if (row.email) notes.push(`email: ${row.email}`);
  if (row.created_time) notes.push(`تاريخ الطلب: ${String(row.created_time).slice(0, 10)}`);
  if (notes.length) fields.notes = notes.join("\n").slice(0, 500);
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  return fields;
}

module.exports = { isMeta, fromMeta, META_FIELDS };
