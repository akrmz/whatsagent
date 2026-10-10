"use strict";

const fs = require("node:fs");
const re = require("./realestate");
const english = require("./english");
const leads = require("./leads");
const rotation = require("./rotation");
const { limiterFor } = require("../core/ratelimit");

// Inquiry capture is triggered by strangers, so it is limited (per bot):
const sameQuestion = (state, key) => limiterFor(state, "inquiry-same", { max: 1, windowMs: 24 * 3600 * 1000 })(key); // a note per client and listing per day
const notifyOwner = (state, key) => limiterFor(state, "inquiry-notify", { max: 1, windowMs: 3600 * 1000 })(key); // a 🔔 per client per hour
const newClients = (state) => limiterFor(state, "inquiry-new", { max: 30, windowMs: 3600 * 1000, size: 1 })("all"); // 30 new clients per hour in all

/** Showing a listing in a chat, and capturing a client's inquiry about one ("#12"). */

/**
 * Private details (the listing's owner) only go to the owner/sudo users in their own chat with
 * the bot, never to a group or a client's chat (where the bot's owner may type a command too).
 */
const staffOnlyChat = (ctx) => ctx.isSudoOrOwner && (ctx.chatId === ctx.sender || ctx.chatId === ctx.botJid);
/** "قناة "عقارات الساحل" · +2010… · wa.me/2010…" — where a listing came from (a draft), or null. */
const sourceText = (l) => {
  const s = l.source;
  if (!s) return null;
  const from = s.kind === "channel" ? `قناة "${s.name || "قناة"}"` : s.kind === "forward" ? "بوست اتحوّل" : s.kind === "feed" ? `جروب السماسرة${s.name ? ` — ${s.name}` : ""}` : s.kind === "notes" ? "رقم كان في الوصف" : s.name || null; // import: as it was exported
  const phones = (s.phones || []).map((p) => `+${p} wa.me/${p}`);
  return [from, ...phones].filter(Boolean).join(" · ") || null;
};
// The owner, and where the listing came from (a broker's number): private, as above.
const ownerLine = (ctx, l) => {
  if (!staffOnlyChat(ctx)) return "";
  const owner = l.owner ? `🔑 المالك (خاص): ${l.owner.name || ""}${l.owner.phone ? ` +${l.owner.phone}` : ""}`.trimEnd() : null;
  const source = sourceText(l) && `🔗 المصدر (خاص): ${sourceText(l)}`;
  return owner || source ? `\n\n${[owner, source].filter(Boolean).join("\n")}` : "";
};

async function show(ctx, l, { allPhotos = false, lang = "ar" } = {}) {
  const a = re.agent(ctx.state);
  // A client in a private chat, with self-booking on: remembered, so "معاينة" means this one.
  const canBook = a.booking && !ctx.isSudoOrOwner && !ctx.isGroup && l.status === "available";
  if (canBook) require("./selfbooking").noteViewed(ctx.state, ctx.sender, l.id);
  const bookLine = canBook ? (lang === "en" ? `\n\n🗓️ To book a viewing, send: معاينة ${l.id}` : `\n\n🗓️ لحجز معاينة ابعت: معاينة ${l.id}`) : "";
  const text = (lang === "en" ? english.card(l, a) : re.card(l, a)) + ownerLine(ctx, l) + bookLine;
  if (!ctx.isSudoOrOwner) re.count(ctx.state, l.id, "views"); // client interest only, not the team's own views
  const pics = re.photos(ctx.config, l);
  if (!pics.length) return ctx.reply(text);
  const shown = allPhotos ? pics : pics.slice(0, 1);
  for (const [i, p] of shown.entries()) {
    await ctx.reply({ image: fs.readFileSync(p), caption: i === 0 ? text : undefined });
  }
  if (!allPhotos && pics.length > 1) await ctx.send(`📷 ${pics.length} صور — ${ctx.prefix}listing ${l.id} photos`);
  return undefined;
}

/**
 * With ".agent autoleads on": someone (not the owner or a sudo user) who asks about a
 * listing in a private chat is saved as a client — or the existing client gets a note —
 * and the owner is told. alts: the similar units the client was offered instead of one that is
 * sold, rented or reserved, noted on the client and in the notice. @returns {{ lead, isNew } | null}
 */
async function captureInquiry(ctx, listing, { alts = [] } = {}) {
  const agent = re.agent(ctx.state);
  if (!agent.autoleads || ctx.isGroup || ctx.isSudoOrOwner || ctx.fromMe) return null;
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  const existing = leads.byPhone(ctx.state, phone);
  const gone = listing.status && listing.status !== "available" ? ` — ${re.STATUS_AR[listing.status]}` : "";
  const offered = alts.length ? `، واتبعتله بدائل: ${alts.map((l) => `#${l.id}`).join("، ")}` : "";
  const text = `سأل عن العقار #${listing.id} (${listing.type || "عقار"}${listing.location ? ` — ${listing.location}` : ""}${gone})${offered}`;
  let lead;
  if (existing) {
    // The same question again within a day adds nothing (and doesn't notify again).
    if (!sameQuestion(ctx.state, `${existing.id}|${listing.id}`)) return { lead: existing, isNew: false };
    lead = leads.note(ctx.state, existing.id, ctx.sender, text);
    re.count(ctx.state, listing.id, "inquiries");
  } else {
    // Many new numbers in a short time (a flood) don't fill the client list.
    if (!newClients(ctx.state)) {
      ctx.log.warn("autoleads: more than 30 new clients in an hour; not saving more for now");
      return null;
    }
    try {
      lead = leads.add(
        ctx.state,
        {
          name: (ctx.senderName || "").slice(0, 60) || undefined,
          phone: phone || undefined,
          ...(listing.type ? { type: listing.type } : {}),
          ...(listing.deal ? { deal: listing.deal } : {}),
          source: "واتساب",
          notes: text,
        },
        ctx.sender,
      );
    } catch (err) {
      ctx.log.warn({ err: err.message }, "autoleads: client not saved");
      return null;
    }
    sameQuestion(ctx.state, `${lead.id}|${listing.id}`);
    if (rotation.assignNext(ctx.app, lead.id)) lead = leads.get(ctx.state, lead.id); // the team member whose turn it is
    re.count(ctx.state, listing.id, "inquiries");
  }
  const owner = ctx.config.owners.numbers[0];
  if (owner && notifyOwner(ctx.state, String(lead.id))) {
    const who = `${lead.name || "عميل"}${phone ? ` (+${phone})` : ""}`;
    await ctx.sock
      .sendMessage(rotation.notifyJid(ctx.app, lead), { text: `🔔 ${existing ? "استفسار من عميل" : "عميل جديد"}: ${who} سأل عن #${listing.id}${gone}${offered}\n${ctx.prefix}lead ${lead.id}` })
      .catch(() => {});
  }
  return { lead, isNew: !existing };
}

module.exports = { show, captureInquiry, ownerLine, sourceText, staffOnlyChat };
