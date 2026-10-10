"use strict";

const re = require("../../services/realestate");
const img = require("../../services/reimages");
const { getText } = require("../../core/context");
const { UserError } = require("../../core/errors");
const leads = require("../../services/leads");
const places = require("../../services/places");
const health = require("../../services/listinghealth");
const slowlistings = require("../../services/slowlistings");
const interest = require("../../services/interest");
const { alternatives } = require("../../services/alternatives");
const { aiFields, shortLinkGeo, vsMarket, clientsLine, autoblast } = require("../../services/newlisting");
const { limiterFor } = require("../../core/ratelimit");

const STATUS_WORDS = {
  available: ["available", "متاح", "متاحة"],
  reserved: ["reserved", "reserve", "محجوز", "حجز"],
  sold: ["sold", "مباع", "تم-البيع", "بيع"],
  rented: ["rented", "مؤجر", "تم-التأجير"],
};
const statusFrom = (w) => Object.keys(STATUS_WORDS).find((k) => STATUS_WORDS[k].includes(w)) || null;

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Text of the command, or of the message it replies to (a broker's post forwarded to the bot). */
const textOrQuoted = (ctx, after) => after.trim() || (ctx.quoted ? getText(ctx.quoted.message) : "");

const { show, ownerLine, staffOnlyChat } = require("../../services/listingview");
const owners = require("../../services/owners");
const campaigns = require("../../services/campaigns");

// Short Maps links are opened (a few requests to Google); clients can trigger that, so it is limited.
const expandBudget = (state) => limiterFor(state, "maps-expand", { max: 30, windowMs: 3600 * 1000, size: 1 })("all");

/**
 * A place from a replied-to location pin, or coordinates/a Maps link in the text or in the
 * replied-to message. @returns {Promise<{ lat, lng, label? } | null>}
 */
async function pointFrom(ctx, text) {
  const pin = places.fromMessage(ctx.quoted?.message);
  if (pin) return pin;
  const sources = [text, ctx.quoted ? getText(ctx.quoted.message) : ""].filter(Boolean);
  for (const s of sources) {
    const p = places.fromText(s);
    if (p) return p;
  }
  for (const s of sources) {
    const short = s.match(places.SHORT);
    if (short && (ctx.isSudoOrOwner || expandBudget(ctx.state))) return places.expandShort(short[0]);
  }
  return null;
}

// ".listing 12 map" / ".listing map 12" show the pin; ".listing loc 12 …" saves it.
const EN = /^(en|english|eng|انجليزي|إنجليزي)$/;
const SHOW_MAP = /^(map|خريطة|الخريطة)$/;
const SET_LOC = /^(loc|location|geo|موقع|الموقع|لوكيشن|اللوكيشن)$/;
const REPORT = /^(report|تقرير|التقرير)$/;
const SEND = /^(send|ابعت|ارسل|أرسل)$/;
const ownerReport = require("../../services/ownerreport");

/** The listing as a WhatsApp location pin (opens in the client's maps app). */
function sendPin(ctx, l) {
  if (!l.geo) return ctx.reply(`#${l.id} has no location saved yet.${ctx.isSudoOrOwner ? ` Add it: reply to a location pin or a Maps link with ${ctx.prefix}listing loc ${l.id}` : ""}`);
  const name = `#${l.id} ${l.type || "عقار"}${l.location ? ` — ${l.location}` : ""}`.slice(0, 100);
  return ctx.reply({ location: { degreesLatitude: l.geo.lat, degreesLongitude: l.geo.lng, name } });
}

/** After a price cut: the clients whose budget the listing fits now but didn't before. */
function priceDropLine(ctx, before, after, showNames) {
  if (!before.price || !after.price || after.price >= before.price) return "";
  const pct = Math.round((1 - after.price / before.price) * 100);
  const fitsNow = leads.matchingLeads(ctx.state, after).filter(({ lead, fit }) => {
    if (fit.over) return false; // still over their budget
    const was = leads.fits(lead, before);
    return !was || was.over; // didn't match at all, or was over budget, before the cut
  });
  const names = showNames ? `: ${fitsNow.slice(0, 5).map(({ lead }) => `#${lead.id} ${lead.name || ""}`.trim()).join("، ")}${fitsNow.length > 5 ? " …" : ""}` : "";
  return `\n\n📉 السعر انخفض ${pct}%${fitsNow.length ? `\n🎯 يناسب الآن ميزانية ${fitsNow.length} من عملائك${names}` : ""}\n📣 بلّغ كل العملاء المناسبين بالسعر الجديد: ${ctx.prefix}blast ${after.id} drop`;
}

/**
 * ".listings near [filters] [5 كم]": the available listings closest to a place — usually a
 * client's location pin that the command replies to — with the distance to each.
 */
async function nearby(ctx, text) {
  const from = await pointFrom(ctx, text);
  if (!from) return ctx.reply(`Reply to a location pin (📎 → Location) or a Google Maps link with ${ctx.prefix}listings near, or write the coordinates after it.`);
  let rest = re.latinDigits(text).replace(places.MAP_LINKS, " ").replace(places.COORDS, " ");
  let radiusKm;
  const r = rest.match(/(\d+(?:\.\d+)?)\s*(?:km|كم|كيلو(?:متر)?)(?![\p{L}])/iu);
  if (r) {
    radiusKm = Number(r[1]);
    rest = rest.replace(r[0], " ");
  }
  const { list, missing } = re.near(ctx.state, from, rest, { radiusKm });
  const staffNote = ctx.isSudoOrOwner && missing ? `\n\n(${missing} matching listing(s) have no saved location: ${ctx.prefix}listing loc <number>)` : "";
  if (!list.length) {
    const why = radiusKm ? `No available listing within ${radiusKm} km matches.` : "No listing with a saved location matches.";
    return ctx.reply(`${why}${staffNote}`);
  }
  const cur = re.agent(ctx.state).currency;
  const shown = list.slice(0, 10);
  const lines = shown.map(({ listing, km }) => `📍 ${places.km(km)} — ${re.line(listing, cur)}`);
  const head = `🗺️ *الأقرب${from.label ? ` إلى ${from.label}` : ""}* (${list.length}${radiusKm ? ` ضمن ${radiusKm} كم` : ""})`;
  return ctx.reply(`${head}\n\n${lines.join("\n")}\n\n${ctx.prefix}listing <number> for details · ${ctx.prefix}listing <number> map for the pin${staffNote}`);
}

/**
 * ".listings slow [days]": available units on the market 30+ days (or the days given), by unit
 * type, the oldest first: the funnel, the price against similar listings and the next step.
 */
function slowCheck(ctx) {
  if (!ctx.isSudoOrOwner) return ctx.reply("Only the owner and sudo users see how listings are doing. Anyone can search them: .listings");
  const p = ctx.prefix;
  const n = Number(re.latinDigits(String(ctx.args[1] || "")));
  const minDays = Number.isInteger(n) && n >= 1 && n <= 365 ? n : slowlistings.MIN_DAYS;
  const { groups, total, available } = slowlistings.slow(ctx.state, { minDays, p });
  if (!available) return ctx.reply(`The catalogue has no available listing yet. ${p}listing add`);
  if (!total) return ctx.reply(`✅ None of your ${available} available listing(s) has been on the market for ${minDays} days or more.`);
  const cur = re.agent(ctx.state).currency;
  const MAX = 25;
  let shown = 0;
  const out = [`🐢 *Slow listings* — ${total} of ${available} available, on the market ${minDays}+ days, the oldest first`];
  for (const g of groups) {
    out.push("", `*${g.type}* (${g.items.length})`);
    for (const it of g.items) {
      if (shown++ >= MAX) break;
      out.push(`▫️ ${re.line(it.listing, cur)} · ${it.days} يوم`, `   ${slowlistings.funnelLine(it.funnel, it.vs)}`, `   ${it.advice.label}`, `   ↳ ${it.advice.fix}`);
    }
  }
  if (total > MAX) out.push("", `… and ${total - MAX} more. Older ones only: ${p}listings slow 90`);
  out.push("", "👀 views · 📣 sent · 💬 asked · 🏠 viewings · 📈 price per m² vs similar listings");
  return ctx.reply(out.join("\n"));
}

/**
 * ".listings check": available listings with something missing (photos, price, size, area,
 * rooms, map pin, owner number) or not updated for 30 days, the most incomplete first, each with
 * the command that fills its biggest gap. Staff only (it's about running the catalogue).
 */
function healthCheck(ctx) {
  if (!ctx.isSudoOrOwner) return ctx.reply("Only the owner and sudo users check the catalogue. Anyone can search it: .listings");
  const p = ctx.prefix;
  const { list, total } = health.check(ctx.state, p);
  if (!total) return ctx.reply(`The catalogue has no available listing yet. ${p}listing add`);
  if (!list.length) return ctx.reply(`✅ All ${total} available listing(s) have photos, a price, a size, an area, rooms, a map pin and an owner number, and were updated in the last ${health.STALE_DAYS} days.`);
  const cur = re.agent(ctx.state).currency;
  const lines = list.slice(0, 20).map(({ listing, gaps }) => `▫️ ${re.line(listing, cur)}\n   ناقص: ${gaps.map((g) => g.label).join(" · ")}\n   ↳ ${gaps[0].fix}`);
  return ctx.reply([`🧹 *Listings to complete* (${list.length} of ${total} available) — the most incomplete first`, "", ...lines, list.length > 20 ? `… and ${list.length - 20} more` : null, "", "Photos and the price matter most: clients' matches, campaigns, the market figures and the assistant all use them."].filter((x) => x !== null).join("\n"));
}

const HELP = (p) =>
  [
    "🏠 *Listings · العقارات*",
    `${p}listing add (then the details, or reply to a post) — add`,
    `${p}listing photo 12 (on a picture) — add a photo`,
    `${p}listing 12 — show · ${p}listing 12 photos — all photos`,
    `${p}listing edit 12 السعر: 3.4 مليون — change fields`,
    `${p}listing status 12 reserved|sold|rented|available`,
    `${p}listing del 12 — delete · ${p}listing match 12 — clients it suits · ${p}listing who 12 — who viewed, asked about or got it`,
    `المالك: الاسم 0100… (in add/edit, private) · ${p}listing ask 12 — ask the owner if it's still available`,
    `${p}listing report 12 — the owner's marketing report (preview) · ${p}listing report 12 send — send it to the owner`,
    `${p}listing loc 12 (reply to a location pin or Maps link) — save where it is · ${p}listing 12 map — send the pin`,
    `${p}listings near (reply to a client's location) — nearest listings`,
    `${p}listings [filters] — search · ${p}flyer 12 — image for posting`,
  ].join("\n");

module.exports = [
  {
    name: "listing",
    aliases: ["property", "aqar"],
    category: "realestate",
    description:
      "عقاراتك في كتالوج واحد — your property catalogue: add a listing from a description (Arabic or English labels, or reply to a broker's post), attach photos, show it with its photos and your contact, save its location on the map (from a location pin or a Google Maps link), mark it reserved/sold, and send its owner a marketing report (clients reached, views, viewings and what viewers said, price vs similar listings). “similar 12” lists available units like it (same type and deal, the same area first, price within 40%); a client asking “#12” about a sold, rented or reserved unit gets up to 3 of them. Anyone can view; the owner and sudo users manage.",
    usage: "add <details> | photo <id> | <id> [photos|map|en] | edit <id> <details> | loc <id> [link|lat,lng|del] | status <id> <status> | report <id> [send] | who <id> | similar <id> | del <id>",
    examples: [".listing add\nالنوع: شقة\nللبيع\nالمنطقة: التجمع الخامس\nالسعر: 3.5 مليون\nالمساحة: 150\nالغرف: 3", ".listing 12", "(reply to a photo) .listing photo 12", "(reply to a location pin) .listing loc 12", ".listing 12 map", ".listing 12 en", ".listing status 12 sold", ".listing report 12", ".listing report 12 send", ".listing who 12", ".listing similar 12"],
    cooldown: 2,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const direct = idOf(sub);
      if (direct) {
        const l = re.get(ctx.state, direct);
        if (!l) return ctx.reply(`There is no listing #${direct}.`);
        if (SHOW_MAP.test(arg) || SET_LOC.test(arg)) return sendPin(ctx, l);
        return show(ctx, l, { allPhotos: /^(photos|all|صور)$/.test(arg), lang: EN.test(arg) ? "en" : "ar" });
      }
      if (!sub) return ctx.reply(HELP(ctx.prefix));
      if (SHOW_MAP.test(sub) && idOf(arg)) {
        const l = re.get(ctx.state, idOf(arg));
        return l ? sendPin(ctx, l) : ctx.reply(`There is no listing #${idOf(arg)}.`);
      }
      if ((sub === "similar" || sub === "alt" || sub === "بدائل" || sub === "شبه") && idOf(arg)) {
        // ".listing similar 12": available units of the same type and deal, the same area first.
        const l = re.get(ctx.state, idOf(arg));
        if (!l) return ctx.reply(`There is no listing #${idOf(arg)}.`);
        const alts = alternatives(ctx.state, l, { max: 5 });
        if (!alts.length) return ctx.reply(`No available ${l.type || "عقار"} لل${l.deal || "بيع"} close to #${l.id} in price (within 40%).`);
        const cur = re.agent(ctx.state).currency;
        const tip = ctx.isSudoOrOwner ? `Send one to a client: ${ctx.prefix}lead send <client> ${alts[0].id}` : `للتفاصيل ابعت رقم العقار، مثلاً #${alts[0].id}`;
        return ctx.reply(`🔄 *Similar to #${l.id}* — ${l.type || "عقار"} لل${l.deal || "بيع"}${l.location ? ` ${l.location.slice(0, 30)}` : ""}\n\n${alts.map((a) => `▫️ ${re.line(a, cur)}`).join("\n")}\n\n${tip}`);
      }
      if (!ctx.isSudoOrOwner) return ctx.reply("Only the owner and sudo users manage listings. Anyone can view them: .listing <number> · .listings");

      if (sub === "add" || sub === "new") {
        const useAi = arg === "ai";
        const body = ctx.text.slice(ctx.args[0].length);
        const text = textOrQuoted(ctx, useAi ? body.replace(/^\s*ai\b/i, "") : body);
        const fields = await shortLinkGeo(useAi ? await aiFields(ctx, text) : re.parseListingText(text, ctx.config.owners.numbers[0]), text);
        const dup = re.findDuplicate(ctx.state, fields);
        const l = re.add(ctx.state, fields, ctx.sender);
        const dupLine = dup ? `\n\n⚠️ This looks like #${dup.id}, already saved. If it's the same property: ${ctx.prefix}listing del ${l.id}` : "";
        const autoLine = dup ? "" : autoblast(ctx, l, { by: ctx.sender, chat: ctx.chatId });
        const priceLine = vsMarket(ctx, l);
        return ctx.reply(`✅ Saved as *#${l.id}*\n\n${re.card(l, re.agent(ctx.state))}${ownerLine(ctx, l)}\n\nAdd photos: reply to a picture with ${ctx.prefix}listing photo ${l.id}${priceLine}${clientsLine(ctx, l, await ctx.isStaffOnlyChat())}${autoLine}${dupLine}`);
      }
      if (sub === "ask") {
        // ".listing ask 12 15 18": ask each owner whether it's still available (at most 5 at once).
        const ids = [...new Set(ctx.args.slice(1).map(idOf).filter(Boolean))];
        if (!ids.length) throw new UserError(`Which listings? ${ctx.prefix}listing ask 12 [15 18 …]`);
        // The owners' answers (with their name and number) come back to this chat.
        if (!(await ctx.isStaffOnlyChat())) return ctx.reply(`🔒 Owners' answers name them and their number, and come back to the chat you ask from: use ${ctx.prefix}listing ask in your private chat with the bot, or in a group of staff only.`);
        if (ids.length > owners.MAX_AT_ONCE) throw new UserError(`At most ${owners.MAX_AT_ONCE} at once, so the owners aren't messaged in a burst.`);
        const done = [];
        const skipped = [];
        for (const n of ids) {
          const l = re.get(ctx.state, n);
          if (!l) skipped.push(`#${n}: not found`);
          else if (!l.owner?.phone) skipped.push(`#${n}: no owner number (${ctx.prefix}listing edit ${n} المالك: الاسم 0100…)`);
          else {
            await owners.ask(ctx, l);
            done.push(`#${n}`);
          }
        }
        return ctx.reply([done.length ? `📤 Asked the owner of ${done.join(", ")} whether it's still available. Their answer comes here.` : null, ...skipped.map((x) => `⚠️ ${x}`)].filter(Boolean).join("\n"));
      }
      const id = idOf(arg);
      if (!id) return ctx.reply(HELP(ctx.prefix));
      if (!re.get(ctx.state, id)) return ctx.reply(`There is no listing #${id}.`);

      if (REPORT.test(sub)) {
        // ".listing report 12": a preview of the owner's report; "… send" sends it to the owner.
        if (!staffOnlyChat(ctx)) return ctx.reply(`The report names the owner and viewers' comments: use ${ctx.prefix}listing report ${id} in your private chat with the bot.`);
        const l = re.get(ctx.state, id);
        const preview = ownerReport.text(ctx.state, l);
        if (!SEND.test(String(ctx.args[2] || "").toLowerCase())) {
          const next = l.owner?.phone
            ? `Send it to the owner (${l.owner.name || "owner"}, +${l.owner.phone}): ${ctx.prefix}listing report ${id} send`
            : `To send it, add the owner's number: ${ctx.prefix}listing edit ${id} المالك: الاسم 0100…`;
          return ctx.reply(`📊 *Report for the owner of #${id}* — preview, not sent yet:\n\n${preview}\n\n${next}`);
        }
        if (!l.owner?.phone) throw new UserError(`#${id} has no owner number. Add it: ${ctx.prefix}listing edit ${id} المالك: الاسم 0100…`);
        const sent = await ownerReport.send(ctx, l);
        if (sent === "off") throw new UserError(`The owner of #${id} asked not to get reports ("وقف التقارير"). They can turn them back on by sending: اشتراك التقارير`);
        if (sent === "recent") throw new UserError(`The owner of #${id} already got a report today. Try again tomorrow.`);
        return ctx.reply(`📤 Sent the marketing report for #${id} to ${l.owner.name || "the owner"} (+${l.owner.phone}).`);
      }

      if (sub === "photo" || sub === "photos" || sub === "صورة") {
        const media = ctx.findMedia({ types: ["image", "document"] });
        if (!media || (media.type === "document" && !/^image\//.test(media.mimetype || ""))) return ctx.reply(`Send a picture with ${ctx.prefix}listing photo ${id} as its caption, or reply to one.`);
        const n = re.addPhoto(ctx.state, ctx.config, id, await img.toListingJpeg(await ctx.download(media, 15 * 1024 * 1024)));
        return ctx.reply(`📷 Photo ${n}/${re.MAX_PHOTOS} added to #${id}.`);
      }
      if (sub === "edit") {
        // Everything after "edit 12", line breaks kept (several fields can be changed at once).
        const text = textOrQuoted(ctx, ctx.text.replace(/^\S+\s+\S+\s*/, ""));
        const changes = await shortLinkGeo(re.parseListingText(text, ctx.config.owners.numbers[0]), text);
        if (!Object.keys(changes).length) throw new UserError(`Write the fields to change, e.g. ${ctx.prefix}listing edit ${id} السعر: 3.4 مليون`);
        const before = { ...re.get(ctx.state, id) };
        // Features named in an edit are added to the ones it has ("مميزات: جراج" adds a garage).
        if (changes.features) changes.features = [...new Set([...re.featuresOf(before), ...changes.features])];
        const l = re.update(ctx.state, id, changes);
        return ctx.reply(`✏️ Updated #${id}: ${Object.keys(changes).join(", ")}\n\n${re.card(l, re.agent(ctx.state))}${ownerLine(ctx, l)}${priceDropLine(ctx, before, l, await ctx.isStaffOnlyChat())}`);
      }
      if (SET_LOC.test(sub)) {
        if (/^(del|delete|remove|off|حذف)$/.test(String(ctx.args[2] || "").toLowerCase())) {
          re.update(ctx.state, id, { geo: null });
          return ctx.reply(`🗺️ Location removed from #${id}.`);
        }
        const geo = await pointFrom(ctx, ctx.args.slice(2).join(" "));
        if (!geo) {
          const p = `${ctx.prefix}listing loc ${id}`;
          return ctx.reply(`Reply to a location pin (📎 → Location) or a Google Maps link with ${p}, or write it after the command:\n${p} https://maps.app.goo.gl/…\n${p} 30.0444, 31.2357`);
        }
        re.update(ctx.state, id, { geo });
        return ctx.reply(`📍 Location saved for #${id}${geo.label ? ` (${geo.label})` : ""}.\n🗺️ ${places.mapsUrl(geo)}\n\nClients near it: reply to their location with ${ctx.prefix}listings near · the pin: ${ctx.prefix}listing ${id} map`);
      }
      if (sub === "who" || sub === "interest" || sub === "interested" || sub === "مين") {
        // ".listing who 12": everyone who viewed, asked about or was sent it — who to call first.
        if (!(await ctx.isStaffOnlyChat())) return ctx.reply(`🔒 The clients for #${id} are private: use ${ctx.prefix}listing who ${id} in your private chat with the bot, or in a group of staff only.`);
        const l = re.get(ctx.state, id);
        const list = interest.forListing(ctx.state, id);
        if (!list.length) return ctx.reply(`Nobody has viewed, asked about or been sent #${id} yet. Clients it suits: ${ctx.prefix}listing match ${id}`);
        const STATUS = leads.STATUS;
        const lines = list.slice(0, 25).map(({ lead, sign }) => `▫️ *#${lead.id}* ${lead.name || "عميل"}${lead.phone ? ` (+${lead.phone})` : ""} — ${sign.label}${sign.at ? ` · ${interest.ago(sign.at)}` : ""} · ${STATUS[lead.status]?.ar || lead.status}`);
        return ctx.reply(
          [
            `👥 *Who's interested in #${id}* — ${l.type || "عقار"}${l.location ? ` ${l.location.slice(0, 30)}` : ""} (${list.length})`,
            "",
            ...lines,
            list.length > 25 ? `… and ${list.length - 25} more` : null,
            "",
            `After a price cut: ${ctx.prefix}blast ${id} drop · send it again: ${ctx.prefix}lead send <client> ${id} · new clients it suits: ${ctx.prefix}listing match ${id}`,
          ]
            .filter((x) => x !== null)
            .join("\n"),
        );
      }
      if (sub === "match" || sub === "clients") {
        if (!(await ctx.isStaffOnlyChat())) return ctx.reply(`🔒 The clients for #${id} are private: use ${ctx.prefix}listing match ${id} in your private chat with the bot, or in a group of staff only.`);
        const m = leads.matchingLeads(ctx.state, re.get(ctx.state, id));
        if (!m.length) return ctx.reply(`No saved client matches #${id} yet (${ctx.prefix}leads).`);
        const cur = re.agent(ctx.state).currency;
        const lines = m.map(({ lead, fit }) => `${leads.line(lead, cur)}${fit.over ? " ⚠️ فوق الميزانية" : ""}`);
        return ctx.reply(`🎯 *Clients for #${id}* (${m.length})\n\n${lines.join("\n")}\n\nSend it: ${ctx.prefix}lead send <client> ${id}`);
      }
      if (sub === "status") {
        const status = statusFrom(String(ctx.args[2] || "").toLowerCase());
        if (!status) throw new UserError("Status: available, reserved, sold or rented (متاح، محجوز، مباع، مؤجر).");
        const was = re.get(ctx.state, id)?.status;
        const l = re.update(ctx.state, id, { status });
        // Available again: who was interested meanwhile (a count only, names are in .blast's preview).
        const told = status === "available" && was !== "available" ? campaigns.targets(ctx.state, l, "back").length : 0;
        const backLine = told ? `\n\n🔁 ${told} client(s) asked about it, booked a viewing or liked it. Tell them it's available again: ${ctx.prefix}blast ${id} back` : "";
        return ctx.reply(`🔖 #${id}: ${re.STATUS_AR[status]}${backLine}`);
      }
      if (sub === "del" || sub === "delete" || sub === "remove") {
        const l = re.remove(ctx.state, ctx.config, id);
        return ctx.reply(`🗑️ Deleted #${l.id} (${l.type || "listing"}${l.location ? `, ${l.location}` : ""}) and its photos.`);
      }
      return ctx.reply(HELP(ctx.prefix));
    },
  },
  {
    name: "listings",
    aliases: ["properties", "aqarat"],
    category: "realestate",
    description:
      'البحث في العقارات المتاحة — searches the available listings. Filters in any order: a type (شقة، فيلا …), بيع/إيجار, a price range ("2m-4m", "<3m", "حتى 3 مليون"), rooms ("3 غرف"), and any words from the location. "all" includes reserved and sold. "near" (replying to a client’s location pin or a Maps link) lists the closest listings with the distance to each, optionally within a radius ("5 كم"). "check" (owner and sudo users) lists the available listings missing photos, a price, a size, an area, rooms, a map pin or an owner number, or not updated for 30 days, the most incomplete first, with the command to fix each. “slow” (owner and sudo users) lists the units on the market 30+ days (or the days given), by unit type, the oldest first: views, sends, questions, viewings and what viewers thought, the price per m² against similar listings, and the next step that fits (photos, follow up the interested, talk price with the owner, market it more …).',
    usage: "[filters] | near [filters] [radius km] | check | slow [days]",
    examples: [".listings", ".listings شقة التجمع 2m-4m", ".listings ايجار 3 غرف", ".listings all", "(reply to a client's location) .listings near", ".listings near شقة 5 كم https://maps.app.goo.gl/…", ".listings check", ".listings slow", ".listings slow 60"],
    cooldown: 3,
    async run(ctx) {
      if (/^(check|health|missing|ناقص|مراجعة)$/i.test(ctx.args[0] || "")) return healthCheck(ctx);
      if (/^(slow|stuck|راكد|راكدة|واقف|واقفة)$/i.test(ctx.args[0] || "")) return slowCheck(ctx);
      const nearWord = /^(near|nearby|nearest|قريب|القريب|الأقرب|الاقرب|جنبي)$/i.test(ctx.args[0] || "");
      if (nearWord || places.fromMessage(ctx.quoted?.message)) return nearby(ctx, nearWord ? ctx.text.replace(/^\s*\S+/, "") : ctx.text);
      const { list, filters } = re.search(ctx.state, ctx.text);
      const cur = re.agent(ctx.state).currency;
      if (!list.length) return ctx.reply(re.all(ctx.state).length ? "No listing matches. Try fewer filters, or .listings all" : `The catalogue is empty. Add one: ${ctx.prefix}listing add`);
      const shown = list.slice(0, 20);
      const head = `🏠 *${list.length} ${filters.all ? "listing(s)" : "available"}*${list.length > shown.length ? ` (first ${shown.length})` : ""}`;
      return ctx.reply(`${head}\n\n${shown.map((l) => re.line(l, cur)).join("\n")}\n\n${ctx.prefix}listing <number> for details and photos`);
    },
  },
];
