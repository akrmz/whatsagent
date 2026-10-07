"use strict";

const fs = require("node:fs");
const re = require("./realestate");
const leads = require("./leads");

/** Showing a listing in a chat, and capturing a client's inquiry about one ("#12"). */

async function show(ctx, l, { allPhotos = false } = {}) {
  const a = re.agent(ctx.state);
  const pics = re.photos(ctx.config, l);
  if (!pics.length) return ctx.reply(re.card(l, a));
  const shown = allPhotos ? pics : pics.slice(0, 1);
  for (const [i, p] of shown.entries()) {
    await ctx.reply({ image: fs.readFileSync(p), caption: i === 0 ? re.card(l, a) : undefined });
  }
  if (!allPhotos && pics.length > 1) await ctx.send(`📷 ${pics.length} صور — ${ctx.prefix}listing ${l.id} photos`);
  return undefined;
}

/**
 * With ".agent autoleads on": someone (not the owner or a sudo user) who asks about a
 * listing in a private chat is saved as a client — or the existing client gets a note —
 * and the owner is told. @returns {{ lead, isNew } | null}
 */
async function captureInquiry(ctx, listing) {
  const agent = re.agent(ctx.state);
  if (!agent.autoleads || ctx.isGroup || ctx.isSudoOrOwner || ctx.fromMe) return null;
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  const existing = phone ? leads.all(ctx.state).find((l) => l.phone === phone) : null;
  const text = `سأل عن العقار #${listing.id} (${listing.type || "عقار"}${listing.location ? ` — ${listing.location}` : ""})`;
  let lead;
  if (existing) lead = leads.note(ctx.state, existing.id, ctx.sender, text);
  else {
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
  }
  const owner = ctx.config.owners.numbers[0];
  if (owner) {
    const who = `${lead.name || "عميل"}${phone ? ` (+${phone})` : ""}`;
    await ctx.sock
      .sendMessage(`${owner}@s.whatsapp.net`, { text: `🔔 ${existing ? "استفسار من عميل" : "عميل جديد"}: ${who} سأل عن #${listing.id}\n${ctx.prefix}lead ${lead.id}` })
      .catch(() => {});
  }
  return { lead, isNew: !existing };
}

module.exports = { show, captureInquiry };
