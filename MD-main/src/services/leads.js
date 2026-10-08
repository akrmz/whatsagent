"use strict";

const { UserError } = require("../core/errors");
const re = require("./realestate");

/**
 * A small client tracker for real-estate agents (.lead / .leads): who the client is, what
 * they want and can pay, where they are in the pipeline, a history of notes, follow-up
 * reminders, and which listings match. Personal data: owner and sudo users only.
 *   DATA_DIR/leads.json { seq, items: { [id]: lead } }
 */

const MAX_LEADS = 5000;
const MAX_NOTES = 50;

const STATUS = {
  new: { ar: "🆕 جديد", words: ["new", "جديد"] },
  contacted: { ar: "📞 تم التواصل", words: ["contacted", "called", "تواصل", "تم-التواصل", "اتصلت"] },
  viewing: { ar: "👀 معاينة", words: ["viewing", "visit", "معاينة", "معاينه", "زيارة"] },
  negotiating: { ar: "🤝 تفاوض", words: ["negotiating", "negotiation", "تفاوض", "مفاوضة"] },
  won: { ar: "✅ تمت الصفقة", words: ["won", "closed", "deal", "تم", "صفقة", "تمت", "اشترى", "بيع"] },
  lost: { ar: "❌ لم يكمل", words: ["lost", "cancel", "cancelled", "لم-يكمل", "الغاء", "إلغاء", "خسارة"] },
};
const statusFrom = (w) => Object.keys(STATUS).find((k) => STATUS[k].words.includes(String(w || "").toLowerCase())) || null;

// ---- phone numbers (services/phones.js) ------------------------------------------------

const { normalizePhone } = require("./phones");

/** Name and number from a shared WhatsApp contact card (vCard). */
function fromVcard(vcard) {
  const v = String(vcard || "");
  const name = (v.match(/^FN:(.*)$/m) || [])[1]?.trim();
  const waid = (v.match(/waid=(\d{6,15})/) || [])[1];
  const tel = (v.match(/^TEL[^:]*:(.+)$/m) || [])[1];
  return { name: name || undefined, phone: waid || (tel ? tel.replace(/[^\d+]/g, "") : undefined) };
}

// ---- reading a client's details ----------------------------------------------------------

const LABELS = {
  name: ["الاسم", "اسم", "العميل", "اسم العميل", "name", "client"],
  phone: ["الموبايل", "موبايل", "الهاتف", "هاتف", "التليفون", "تليفون", "الرقم", "رقم", "واتساب", "واتس", "phone", "mobile", "whatsapp", "tel"],
  budget: ["الميزانية", "ميزانية", "الميزانيه", "السعر", "budget", "price"],
  type: ["النوع", "نوع", "المطلوب", "يريد", "type", "wants", "looking for"],
  location: ["المنطقة", "منطقة", "الموقع", "المكان", "location", "area", "city"],
  rooms: ["الغرف", "غرف", "عدد الغرف", "rooms", "bedrooms"],
  deal: ["الغرض", "deal", "for", "purpose"],
  source: ["المصدر", "مصدر", "جاء من", "source", "from"],
  campaign: ["الإعلان", "اعلان", "إعلان", "الحملة", "حملة", "campaign", "ad"],
  notes: ["ملاحظات", "ملاحظة", "notes", "note"],
};
const LABEL_OF = new Map(Object.entries(LABELS).flatMap(([k, words]) => words.map((w) => [w.toLowerCase(), k])));

/** "2-3 مليون", "من 2 إلى 3 مليون", "2m-3m", "حتى 3 مليون", "<3m", "3 مليون" → { min, max } */
function parseBudget(text) {
  const s = re
    .latinDigits(String(text || ""))
    .toLowerCase()
    .replace(/من\s+/, "")
    .replace(/\s*(إلى|الى|لـ|to)\s*/, "-")
    .replace(/\s+ل\s*(?=\d)/, "-"); // "2 ل 3 مليون"
  const unit = String.raw`(مليون|ملايين|million|m|ألف|الف|k)?`;
  let m = s.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${unit}\s*-\s*(\d+(?:\.\d+)?)\s*${unit}`));
  if (m) {
    const u = m[4] || m[2] || "";
    const [a, b] = [re.parseAmount(`${m[1]} ${m[2] || u}`), re.parseAmount(`${m[3]} ${u}`)];
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const max = re.parseAmount(s);
  return max ? { max } : {};
}

/**
 * A budget written in a sentence: after "ميزانية" / "في حدود" / "لحد" / "حتى" / "budget", or a
 * range "من 2 ل 3 مليون". A number on its own isn't taken as a budget.
 */
function budgetIn(text) {
  const t = re.latinDigits(String(text || ""));
  const amount = String.raw`\d[\d.,]*\s*(?:مليون|ملايين|ألف|الف|m|k)?`;
  const m =
    t.match(/(?:ميزانية|ميزانيه|ميزانيته|ميزانيتها|بميزانية|في حدود|حدود|لحد|حتى|budget)\s*:?\s*([^،,\n]{1,40})/iu) ||
    t.match(new RegExp(`(من\\s*${amount}\\s*(?:ل|لـ|إلى|الى|-|to)\\s*${amount})`, "iu"));
  return m ? parseBudget(m[1]) : {};
}

/** Labelled lines ("الاسم: …", "الموبايل: …", "الميزانية: 2-3 مليون" …); unlabeled lines become notes. */
function parseLeadText(text, ownerNumber) {
  const out = {};
  const notes = [];
  for (const raw of String(text || "").split(/\n+/)) {
    const line = raw.replace(/^(?:[\s•▪◾🔹🔸*\-–—✅📍💰👤📞]|️)+/u, "").trim();
    if (!line) continue;
    const m = line.match(/^([^:：]{1,20})\s*[:：]\s*(.+)$/);
    const key = m && LABEL_OF.get(m[1].trim().toLowerCase());
    if (!key) {
      notes.push(line);
      continue;
    }
    const v = m[2].trim();
    if (key === "phone") out.phone = normalizePhone(v, ownerNumber) || undefined;
    else if (key === "budget") Object.assign(out, parseBudget(v));
    else if (key === "type") out.type = re.typeIn(v) || v.slice(0, 30);
    else if (key === "deal") out.deal = re.dealIn(v) || undefined;
    else if (key === "rooms") out.rooms = Number(re.latinDigits(v).match(/\d+/)?.[0]) || undefined;
    else if (key === "notes") notes.push(v);
    else out[key] = v.slice(0, key === "location" ? 80 : 60);
  }
  const all = String(text || "");
  out.type ||= re.typeIn(all) || undefined;
  out.deal ||= re.dealIn(all) || undefined;
  if (!out.phone) {
    const m = re.latinDigits(all).match(/(?:\+|00)?\d[\d\s-]{7,16}\d/);
    if (m) {
      const p = normalizePhone(m[0], ownerNumber);
      if (p) {
        out.phone = p;
        const i = notes.findIndex((l) => re.latinDigits(l).includes(m[0]));
        if (i >= 0 && re.latinDigits(notes[i]).replace(m[0], "").trim().length < 3) notes.splice(i, 1);
      }
    }
  }
  // Wishes written as a sentence: "عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون".
  const free = notes.join("\n");
  if (free) {
    const f = re.extractFree(free);
    if (out.rooms === undefined && f.rooms) out.rooms = f.rooms;
    if (!out.location && f.location) out.location = f.location.slice(0, 80);
    if (out.min === undefined && out.max === undefined) Object.assign(out, budgetIn(free));
  }
  if (notes.length) out.notes = notes.join("\n").slice(0, 500);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// ---- the leads ----------------------------------------------------------------------------

const store = (state) => state.store("leads", { seq: 0, items: {} });
const get = (state, id) => store(state).data.items[id] || null;
const all = (state) => Object.values(store(state).data.items).sort((a, b) => b.updated - a.updated);
/** The client with this number (digits only, as saved), or null. Unsorted: used on every private message. */
const byPhone = (state, phone) => (phone ? Object.values(store(state).data.items).find((l) => l.phone === phone) || null : null);

function add(state, fields, by, now = Date.now()) {
  if (!fields.name && !fields.phone) throw new UserError("Give at least the client's name or phone, e.g.\nالاسم: أحمد\nالموبايل: 01001234567\nالميزانية: 2-3 مليون\nالنوع: شقة\nالمنطقة: التجمع");
  const { notes, ...rest } = fields;
  return store(state).update((d) => {
    if (Object.keys(d.items).length >= MAX_LEADS) throw new UserError(`You have ${MAX_LEADS} clients saved. Delete old ones first.`);
    if (rest.phone) {
      const dup = Object.values(d.items).find((l) => l.phone === rest.phone);
      if (dup) throw new UserError(`This number is already saved as client #${dup.id} (${dup.name || "no name"}). See .lead ${dup.id}`);
    }
    const id = ++d.seq;
    d.items[id] = { id, ...rest, status: "new", history: notes ? [{ at: now, by, text: notes }] : [], created: now, updated: now };
    return d.items[id];
  });
}

function update(state, id, changes, now = Date.now()) {
  return store(state).update((d) => {
    const l = d.items[id];
    if (!l) throw new UserError(`There is no client #${id}.`);
    if (changes.status === "won" && l.status !== "won") l.wonAt = now; // for "days to a deal" in .restats
    Object.assign(l, changes, { updated: now });
    for (const k of Object.keys(l)) if (l[k] === null) delete l[k];
    return l;
  });
}

function note(state, id, by, text, now = Date.now()) {
  const body = String(text || "").trim().slice(0, 500);
  if (!body) throw new UserError("Write the note after the client number.");
  return store(state).update((d) => {
    const l = d.items[id];
    if (!l) throw new UserError(`There is no client #${id}.`);
    l.history.push({ at: now, by, text: body });
    if (l.history.length > MAX_NOTES) l.history.splice(0, l.history.length - MAX_NOTES);
    l.updated = now;
    return l;
  });
}

/**
 * A listing (or an offer for it) was sent to the client: noted in their history, remembered so
 * campaigns don't send it again, counted on the listing, and a new client becomes "contacted".
 */
function markSent(state, id, listingIds, by, text, now = Date.now()) {
  const ids = [].concat(listingIds); // one listing or several (one history note either way)
  note(state, id, by, text, now);
  for (const listingId of ids) re.count(state, listingId, "sent");
  return store(state).update((d) => {
    const l = d.items[id];
    l.sentListings = [...new Set([...(l.sentListings || []), ...ids])].slice(-200);
    Object.assign(l, { lastSentAt: now, lastSentListing: ids[0] });
    if (l.status === "new") l.status = "contacted";
    return l;
  });
}

/** A welcome was sent (.leads welcome): noted, the client "contacted", and their reply will be tracked. */
function markWelcomed(state, id, by, now = Date.now()) {
  note(state, id, by, "أُرسلت له رسالة ترحيب", now);
  return store(state).update((d) => {
    const l = d.items[id];
    Object.assign(l, { welcomedAt: now, lastSentAt: now, lastSentListing: null });
    if (l.status === "new") l.status = "contacted";
    return l;
  });
}

/** What was sent last: "#12", or the welcome. */
const sentWhat = (l) => (l.lastSentListing ? `#${l.lastSentListing}` : "رسالة الترحيب");

const SEEN_GAP = 10 * 60 * 1000;
/** Did the client write since we last sent them something? */
const awaitingReply = (l) => Boolean(l.lastSentAt) && !(l.lastMsgAt > l.lastSentAt);

/**
 * The client wrote to us (a private message). Remembered at most every 10 minutes, except the
 * first message after something was sent to them, which is noted as a reply.
 * @returns {{ replied: number | null } | null} replied: the listing they answered, if any
 */
function seen(state, id, now = Date.now()) {
  const l = get(state, id);
  if (!l) return null;
  const reply = awaitingReply(l);
  if (!reply && now - (l.lastMsgAt || 0) < SEEN_GAP) return { replied: null };
  store(state).update((d) => {
    const x = d.items[id];
    Object.assign(x, { lastMsgAt: now, updated: now });
    if (reply) {
      x.replied = true;
      x.history.push({ at: now, by: "client", text: x.lastSentListing ? `ردّ بعد إرسال العقار #${x.lastSentListing}` : "ردّ على رسالة الترحيب" });
      if (x.history.length > MAX_NOTES) x.history.splice(0, x.history.length - MAX_NOTES);
    }
  });
  return { replied: reply ? l.lastSentListing : null };
}

/** What a client sends to stop or restart offers (see listeners/optout.js). */
const STOP_WORDS = /^(وقف|توقف|ايقاف|إيقاف|الغاء|إلغاء|stop|unsubscribe)$/i;
const START_WORDS = /^(اشتراك|اشترك|start|subscribe)$/i;
/** "وقف!" → "stop", "اشتراك" → "start", anything else → null. */
function optWord(text) {
  const w = String(text || "").trim().replace(/[.!؟?]+$/, "");
  return STOP_WORDS.test(w) ? "stop" : START_WORDS.test(w) ? "start" : null;
}

/** The client asked to stop (or restart) offers: "وقف" / "اشتراك". */
function setOptOut(state, id, optedOut, now = Date.now()) {
  update(state, id, { optedOut: optedOut || null, optedOutAt: optedOut ? now : null }, now);
  return note(state, id, "client", optedOut ? "طلب إيقاف رسائل العروض (وقف)" : "طلب استقبال العروض مرة أخرى", now);
}

const remove = (state, id) =>
  store(state).update((d) => {
    const l = d.items[id];
    if (!l) throw new UserError(`There is no client #${id}.`);
    delete d.items[id];
    return l;
  });

// ---- matching ----------------------------------------------------------------------------

const locationWords = (s) => re.latinDigits(String(s || "")).toLowerCase().split(/[\s,،\-–/]+/).filter((w) => w.length > 2 && !["كمبوند", "compound", "مدينة", "city"].includes(w));

/** Does a listing fit what the client wants? @returns {null | { over: boolean }} */
function fits(lead, listing) {
  if (listing.status !== "available") return null;
  // A client without any wishes yet (e.g. saved from a contact card) matches nothing, not everything.
  if (!lead.type && !lead.deal && !lead.location && !lead.min && !lead.max && !lead.rooms) return null;
  if (lead.deal && listing.deal && lead.deal !== listing.deal) return null;
  if (lead.type && listing.type && lead.type !== listing.type) return null;
  if (lead.rooms && listing.rooms && listing.rooms < lead.rooms) return null;
  if (lead.max && listing.price && listing.price > lead.max * 1.1) return null;
  if (lead.min && listing.price && listing.price < lead.min * 0.7) return null;
  const words = locationWords(lead.location);
  if (words.length) {
    const where = re.latinDigits(`${listing.location || ""}`).toLowerCase();
    if (!words.some((w) => where.includes(w))) return null;
  }
  return { over: Boolean(lead.max && listing.price > lead.max) };
}

/** Within budget first, then a little over; cheaper first within each. */
const matchingListings = (state, lead) =>
  re
    .all(state)
    .map((l) => ({ listing: l, fit: fits(lead, l) }))
    .filter((x) => x.fit)
    .sort((a, b) => a.fit.over - b.fit.over || (a.listing.price || 0) - (b.listing.price || 0));

const matchingLeads = (state, listing) =>
  all(state)
    .filter((l) => !["won", "lost"].includes(l.status))
    .map((lead) => ({ lead, fit: fits(lead, listing) }))
    .filter((x) => x.fit);

// ---- formatting ----------------------------------------------------------------------------

const when = (t, timeZone) => new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const budgetText = (l, cur) =>
  l.min && l.max ? `${re.shortAr(l.min)} – ${re.shortAr(l.max)} ${cur}` : l.max ? `حتى ${re.shortAr(l.max)} ${cur}` : l.min ? `من ${re.shortAr(l.min)} ${cur}` : null;
const phoneText = (p) => (p ? `+${p}` : null);

function card(lead, { currency = "جنيه", timeZone = "UTC", matches = [] } = {}) {
  const wants = [lead.type, lead.deal && `لل${lead.deal}`, lead.rooms && `${lead.rooms} غرف`, lead.location && `في ${lead.location}`].filter(Boolean).join(" ");
  const lines = [
    `👤 *${lead.name || "عميل"}* — #${lead.id}`,
    lead.phone && `📞 ${phoneText(lead.phone)}`,
    wants && `🔎 يبحث عن: ${wants}`,
    budgetText(lead, currency) && `💰 الميزانية: ${budgetText(lead, currency)}`,
    lead.source && `📣 المصدر: ${lead.source}${lead.campaign ? ` — إعلان: ${lead.campaign}` : ""}`,
    `🔖 ${STATUS[lead.status]?.ar || lead.status}`,
    lead.assignee && `🧑‍💼 المسؤول: @${lead.assignee.split("@")[0]}`,
    lead.optedOut && "🚫 أوقف رسائل العروض (أرسل وقف)",
    lead.lastSentAt && `📤 آخر إرسال: ${sentWhat(lead)} — ${when(lead.lastSentAt, timeZone)}${awaitingReply(lead) ? " (لم يرد بعد)" : ""}`,
    lead.lastMsgAt && `💬 آخر رسالة منه: ${when(lead.lastMsgAt, timeZone)}`,
    lead.followUp && `⏰ متابعة: ${when(lead.followUp.at, timeZone)}${lead.followUp.note ? ` — ${lead.followUp.note}` : ""}`,
  ];
  if (lead.history?.length) lines.push("", "*السجل:*", ...lead.history.slice(-5).map((h) => `▫️ ${when(h.at, timeZone)}: ${h.text}`));
  if (matches.length) {
    lines.push("", `🎯 *عقارات مناسبة (${matches.length}):*`, ...matches.slice(0, 5).map((m) => `${re.line(m.listing, currency)}${m.fit.over ? " ⚠️ أعلى من الميزانية" : ""}`));
  }
  return lines.filter((l) => l !== null && l !== undefined && l !== false).join("\n");
}

const line = (l, cur) =>
  `*#${l.id}* ${l.name || "عميل"}${l.phone ? ` (${phoneText(l.phone)})` : ""} — ${STATUS[l.status]?.ar || l.status}${l.type ? ` · ${l.type}` : ""}${budgetText(l, cur) ? ` · ${budgetText(l, cur)}` : ""}${l.followUp ? " ⏰" : ""}`;

// ---- follow-ups ----------------------------------------------------------------------------

function setFollowUp(state, id, { at, chat, by, note: text }) {
  return update(state, id, { followUp: { at, chat, by, ...(text ? { note: text.slice(0, 200) } : {}) } });
}

/** Sends the follow-up reminders that are due (to the chat where they were set). */
async function runDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  let sent = 0;
  for (const lead of Object.values(store(app.state).data.items)) {
    const f = lead.followUp;
    if (!f || f.at > now) continue;
    update(app.state, lead.id, { followUp: null }, lead.updated);
    try {
      await app.sock.sendMessage(f.chat, {
        text: `⏰ *متابعة العميل #${lead.id}* — ${lead.name || ""}${lead.phone ? ` ${phoneText(lead.phone)}` : ""}${f.note ? `\n📝 ${f.note}` : ""}\n${app.config.bot.prefix}lead ${lead.id}`,
        mentions: [...new Set([f.by, lead.assignee].filter(Boolean))],
      });
      sent++;
    } catch (err) {
      app.log.warn({ err: err.message }, "could not send a client follow-up reminder");
    }
  }
  return sent;
}

function startFollowUpLoop(app) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDue(app);
    } catch (err) {
      app.log.error({ err }, "follow-up loop failed");
    } finally {
      running = false;
    }
  }, 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Text search over name, phone, location, source and notes; or a status word; or "mine"
 * (the clients assigned to `me`, a list of the asker's JID forms).
 */
function search(state, query, { me = [] } = {}) {
  const q = re.latinDigits(String(query || "")).trim().toLowerCase();
  if (["mine", "my", "لي", "عملائي"].includes(q)) return all(state).filter((l) => l.assignee && me.includes(l.assignee));
  const status = statusFrom(q);
  if (status) return all(state).filter((l) => l.status === status);
  if (!q) return all(state);
  const digits = q.replace(/\D/g, "");
  return all(state).filter((l) => {
    if (digits.length >= 4 && l.phone?.includes(digits)) return true;
    const hay = `${l.name || ""} ${l.location || ""} ${l.source || ""} ${l.type || ""} ${(l.history || []).map((h) => h.text).join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

module.exports = {
  STATUS, statusFrom, normalizePhone, fromVcard, parseBudget, parseLeadText,
  add, update, note, byPhone, markSent, markWelcomed, sentWhat, seen, awaitingReply, setOptOut, optWord, remove, get, all, search,
  fits, matchingListings, matchingLeads, card, line, budgetText,
  setFollowUp, runDue, startFollowUpLoop,
};
