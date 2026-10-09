"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const market = require("../../services/market");
const marketImage = require("../../services/marketimage");
const compareImage = require("../../services/compareimage");
const { limiterFor } = require("../../core/ratelimit");
const calc = require("../../services/recalc");
const offer = require("../../services/offer");
const img = require("../../services/reimages");
const pdf = require("../../services/pdf");
const places = require("../../services/places");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const cur = (ctx) => re.agent(ctx.state).currency;
const perM = (n, l) => `${re.group(n)}${l.deal === "إيجار" ? " شهرياً" : ""}`;
const NOT_VALUATION = "_من العقارات المسجلة عندك فقط (يشمل المحجوز والمباع)، وليس تقييماً رسمياً._";
const fileSafe = (s) => String(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40);

/** ".market 12": the listing's price per m² against similar listings. */
function listingVsMarket(ctx, l) {
  const c = cur(ctx);
  const r = market.compareToMarket(ctx.state, l);
  if (!market.ppm(l)) return `#${l.id} needs a price and a size to compare (${ctx.prefix}listing edit ${l.id} المساحة: 150).`;
  if (!r.stats) {
    return `Only ${r.similar.length} similar listing(s) (${l.type || "عقار"} لل${l.deal || "بيع"} in the same area, with a price and size) — at least ${market.MIN_SIMILAR} are needed to compare. ${ctx.prefix}market shows all areas.`;
  }
  const verdict = Math.abs(r.diffPct) <= 5 ? "✅ في حدود السوق" : r.diffPct > 0 ? `⬆️ أعلى من الوسيط بـ ${r.diffPct}%` : `⬇️ أقل من الوسيط بـ ${-r.diffPct}%`;
  const ids = r.similar.slice(0, 10).map((s) => `#${s.id}`).join("، ");
  return [
    `📊 *#${l.id} مقارنة بالسوق*`,
    `${l.type || "عقار"} لل${l.deal || "بيع"}${l.location ? ` — ${l.location}` : ""}`,
    "",
    `💵 سعر المتر: *${perM(r.ppm, l)} ${c}*`,
    `📈 وسيط ${r.stats.priced} عقار مشابه: ${perM(r.stats.median, l)} ${c} (المعتاد ${re.group(r.stats.low)} – ${re.group(r.stats.high)})`,
    verdict,
    r.range ? `🎯 السعر الذي يضعه في منتصف السوق: ${re.shortAr(r.range[0])} – ${re.shortAr(r.range[1])} ${c}` : null,
    `المشابهة: ${ids}${r.similar.length > 10 ? " …" : ""}`,
    "",
    NOT_VALUATION,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** One line per field, a value per listing; the best value marked when they differ. */
function compareText(ctx, list) {
  const c = cur(ctx);
  const best = (values, pick) => {
    const nums = values.filter((v) => typeof v === "number");
    if (nums.length < 2 || nums.every((v) => v === nums[0])) return null;
    return pick === "min" ? Math.min(...nums) : Math.max(...nums);
  };
  const row = (icon, label, values, { fmt = String, pick } = {}) => {
    if (values.every((v) => v === undefined || v === null || v === "")) return null;
    const b = pick ? best(values, pick) : null;
    return `${icon} ${label}: ${list.map((l, i) => `#${l.id} ${values[i] === undefined || values[i] === null || values[i] === "" ? "—" : fmt(values[i])}${b !== null && values[i] === b ? " ✅" : ""}`).join(" | ")}`;
  };
  const lines = [
    `⚖️ *مقارنة* ${list.map((l) => `#${l.id}`).join(" · ")}`,
    "",
    row("🏠", "النوع", list.map((l) => `${l.type || "عقار"} لل${l.deal || "بيع"}`)),
    row("📍", "المنطقة", list.map((l) => l.location && l.location.slice(0, 30))),
    row("💰", "السعر", list.map((l) => l.price), { fmt: (v) => re.shortAr(v), pick: "min" }),
    row("📐", "المساحة", list.map((l) => l.size), { fmt: (v) => `${re.group(v)} م²`, pick: "max" }),
    row("💵", "سعر المتر", list.map((l) => (market.ppm(l) ? Math.round(market.ppm(l)) : null)), { fmt: (v) => re.group(v), pick: "min" }),
    row("🛏", "الغرف", list.map((l) => l.rooms), { pick: "max" }),
    row("🛁", "الحمامات", list.map((l) => l.baths), { pick: "max" }),
    row("🏢", "الدور", list.map((l) => l.floor)),
    row("✨", "التشطيب", list.map((l) => l.finishing)),
    row("🔖", "الحالة", list.map((l) => re.STATUS_AR[l.status] || l.status)),
  ];
  if (list.length === 2 && list[0].geo && list[1].geo) lines.push(`📏 المسافة بينهما: ${places.km(places.distanceKm(list[0].geo, list[1].geo))}`);
  lines.push("", `✅ = الأفضل (أقل سعر، أكبر مساحة …) · ${ctx.prefix}listing <رقم> للتفاصيل · العملة: ${c}`);
  return lines.filter((x) => x !== null).join("\n");
}

const SEND = /^(send|ابعت|ابعتله|ارسل|أرسل|إرسال)$/;
const CLIENT = /^(client|lead|عميل|للعميل)$/;

/** ".offer 12 #5 10% 8 quarterly send" → { listing, lead, planText, send } */
function parseOffer(ctx) {
  const tokens = [...ctx.args];
  const listing = re.get(ctx.state, idOf(tokens.shift()));
  if (!listing) throw new UserError(`Which listing? ${ctx.prefix}offer <listing> [#client] [down % years frequency] [send]\ne.g. ${ctx.prefix}offer 12 #5 10% 8 quarterly`);
  let lead = null;
  let send = false;
  const plan = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (SEND.test(t)) send = true;
    else if (/^#\d+$/.test(re.latinDigits(t)) || (CLIENT.test(t) && idOf(tokens[i + 1]))) {
      const id = CLIENT.test(t) ? idOf(tokens[++i]) : idOf(t);
      lead = leads.get(ctx.state, id);
      if (!lead) throw new UserError(`There is no client #${id} (${ctx.prefix}leads).`);
    } else plan.push(tokens[i]);
  }
  return { listing, lead, planText: plan.join(" "), send };
}

module.exports = [
  {
    name: "market",
    aliases: ["prices", "areastats", "souq", "pricing"],
    category: "realestate",
    description:
      "أسعار السوق من كتالوجك — price per m² from your own listings (including reserved and sold): by area and type, the median and the usual range, with the same filters as .listings. \".market 12\" compares a listing with similar ones and suggests the price range that puts it mid-market. \"image\" makes a picture to post (1080×1350) for each unit type — apartments, villas, chalets …: the price per m² by area as bars, with your contact. Owner and sudo users.",
    usage: "[filters] | <listing number> | image [filters]",
    examples: [".market", ".market التجمع", ".market شقة بيع زايد", ".market 12", ".market image", ".market image شاليه", ".market image إيجار"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const one = ctx.args.length === 1 && idOf(ctx.args[0]);
      if (one) {
        const l = re.get(ctx.state, one);
        if (!l) return ctx.reply(`There is no listing #${one}.`);
        return ctx.reply(listingVsMarket(ctx, l));
      }
      if (/^(image|picture|post|صورة|صوره|بوست)$/i.test(ctx.args[0] || "")) {
        // ".market image [filters]": a picture to post for each unit type (apartments, villas, chalets …).
        await ctx.react("🎨");
        const query = ctx.text.replace(/^\s*\S+\s*/, "");
        const pics = await marketImage.render(ctx.state, query, ctx.config.bot.timezone);
        if (!pics.length) return ctx.reply(`Not enough figures for a picture yet: it needs at least ${marketImage.MIN_PRICED} listings with a price and a size in the same area${query ? ` (for "${query}")` : ""}.`);
        for (const p of pics) await ctx.reply({ image: p.image, caption: p.caption });
        return undefined;
      }
      const r = market.report(ctx.state, ctx.text);
      const groups = r.groups.filter((g) => g.priced);
      if (!groups.length) return ctx.reply(`No listing ${ctx.text ? "matching that " : ""}has both a price and a size yet. ${ctx.prefix}market works from your saved listings.`);
      const c = cur(ctx);
      const isRent = (g) => / للإيجار$/.test(g.name);
      const lines = [`📊 *أسعار السوق من كتالوجك*${ctx.text ? ` — ${ctx.text}` : ""}`, `${r.total.count} عقار، منها ${r.total.priced} بسعر ومساحة`, ""];
      for (const g of groups.slice(0, 15)) {
        const range = g.priced >= 3 ? ` (المعتاد ${re.group(g.low)} – ${re.group(g.high)})` : "";
        lines.push(`▫️ *${g.name}*: ${g.priced} · ${isRent(g) ? "إيجار المتر شهرياً" : "المتر"} ${re.group(g.median)} ${c}${range}`);
      }
      if (groups.length > 15) lines.push(`… ${groups.length - 15} more — narrow it down: ${ctx.prefix}market التجمع شقة`);
      lines.push("", `${ctx.prefix}market <listing number> — is a listing priced right?`, NOT_VALUATION);
      return ctx.reply(lines.join("\n"));
    },
  },
  {
    name: "compare",
    aliases: ["qarn", "moqarna", "vs"],
    category: "realestate",
    description: "مقارنة العقارات — 2 to 4 listings side by side: price, size, price per m², rooms, baths, floor, finishing and status, with the best value marked, and the distance between two listings when both have a location. \"image\" makes it a picture to send a client (2 or 3 listings: photos, price, size, price per m², rooms, payment plan and features, with your contact).",
    usage: "<listing> <listing> [listing] [listing] [image]",
    examples: [".compare 3 7", ".compare 3 7 9", ".compare 3 7 9 image"],
    cooldown: 3,
    async run(ctx) {
      const ids = [...new Set(ctx.args.map(idOf).filter(Boolean))];
      const asImage = ctx.args.some((w) => /^(image|picture|صورة|صوره)$/i.test(w));
      if (ids.length < 2 || ids.length > (asImage ? compareImage.MAX : 4)) return ctx.reply(asImage ? `A picture compares 2 or 3 listings: ${ctx.prefix}compare 3 7 12 image` : `Write 2 to 4 listing numbers: ${ctx.prefix}compare 3 7`);
      const missing = ids.filter((id) => !re.get(ctx.state, id));
      if (missing.length) return ctx.reply(`There is no listing ${missing.map((id) => `#${id}`).join(", ")}.`);
      const list = ids.map((id) => re.get(ctx.state, id));
      if (!asImage) return ctx.reply(compareText(ctx, list));
      // A picture to send a client; drawing costs more than text, so clients get a few.
      if (!ctx.isSudoOrOwner && !limiterFor(ctx.state, "compare-image", { max: 3, windowMs: 10 * 60 * 1000 })(ctx.sender)) return ctx.reply("You can make 3 comparison pictures every 10 minutes. The text version: " + `${ctx.prefix}compare ${ids.join(" ")}`);
      await ctx.react("🎨");
      return ctx.reply({ image: await compareImage.render(ctx.state, ctx.config, list), caption: `مقارنة ${list.map((l) => `#${l.id}`).join(" · ")} — للتفاصيل والصور أرسل رقم العقار (مثلاً #${list[0].id})` });
    },
  },
  {
    name: "offer",
    aliases: ["pricequote", "ard", "proposal"],
    category: "realestate",
    description:
      "عرض سعر PDF — a price offer for a listing as a PDF: the client's name, the property, the price and, with a payment plan (down payment, years, frequency, maintenance), every instalment with its date, plus the listing's flyer. Valid for 7 days. Add a client (#5) to put their name on it, and \"send\" to send it to them on WhatsApp (noted in their history). Owner and sudo users.",
    usage: "<listing> [#client] [down % or amount] [years] [monthly|quarterly|semiannual|yearly] [maint <%>] [send]",
    examples: [".offer 12", ".offer 12 #5 10% 8 quarterly", ".offer 12 #5 15% 6 monthly maint 8% send"],
    permission: "sudo",
    cooldown: 10,
    async run(ctx) {
      if (!ctx.args.length) return ctx.reply(`Usage: ${ctx.prefix}offer <listing> [#client] [down % years frequency] [send]\ne.g. ${ctx.prefix}offer 12 #5 10% 8 quarterly`);
      const { listing, lead, planText, send } = parseOffer(ctx);
      if (lead && !(await ctx.isStaffOnlyChat())) throw new UserError(`🔒 An offer for a client names them: use it in your private chat with the bot, or in a group of staff only. Without the client: ${ctx.prefix}offer ${listing.id}`);
      if (!listing.price) throw new UserError(`#${listing.id} has no price yet: ${ctx.prefix}listing edit ${listing.id} السعر: 3.5 مليون`);
      if (planText && listing.deal === "إيجار") throw new UserError("Payment plans are for listings for sale.");
      let plan;
      try {
        plan = planText ? calc.installments(`${listing.price} ${planText}`) : null;
      } catch (err) {
        if (!(err instanceof UserError) || !/^Usage/.test(err.message)) throw err;
        throw new UserError(`The payment plan is: down payment (% or amount), years, then optionally monthly/quarterly/yearly and maint 8%. The client goes with # (#5).\ne.g. ${ctx.prefix}offer ${listing.id} #5 10% 8 quarterly`);
      }
      if (send && !lead) throw new UserError(`Send it to which client? ${ctx.prefix}offer ${listing.id} #<client> … send`);
      if (send && !lead.phone) throw new UserError(`Client #${lead.id} has no phone number. Add one: ${ctx.prefix}lead edit ${lead.id} الموبايل: 01001234567`);
      if (send && lead.optedOut) throw new UserError(`Client #${lead.id} asked not to receive offers (وقف). If they ask for them again, they can send اشتراك.`);

      await ctx.react("📄");
      const agent = re.agent(ctx.state);
      const sheets = await offer.render({ listing, agent, client: lead, plan, timeZone: ctx.config.bot.timezone });
      const [photo] = re.photos(ctx.config, listing);
      const pages = [...sheets.map((data) => ({ data, width: offer.W, height: offer.H })), { data: await img.flyer(listing, agent, photo), width: 1080, height: 1350 }];
      const document = pdf.build(pages);
      const fileName = `${["عرض-سعر", listing.id, lead?.name && fileSafe(lead.name)].filter(Boolean).join("-")}.pdf`;
      const what = plan ? `${+plan.downPct.toFixed(1)}% مقدم، ${plan.years} سنوات ${plan.freq}` : "كاش";

      if (!send) return ctx.reply({ document, mimetype: "application/pdf", fileName, caption: `📄 عرض سعر #${listing.id}${lead ? ` لـ ${lead.name || `#${lead.id}`}` : ""} — ${what}` });

      const jid = `${lead.phone}@s.whatsapp.net`;
      const [found] = (await ctx.sock.onWhatsApp?.(jid).catch(() => null)) || [];
      if (found && !found.exists) throw new UserError(`+${lead.phone} is not on WhatsApp.`);
      const greeting = `${lead.name ? `أهلاً ${lead.name} 👋\n` : ""}مرفق عرض السعر للعقار #${listing.id} (${listing.type || "عقار"}${listing.location ? ` — ${listing.location}` : ""}).`;
      await ctx.sock.sendMessage(jid, { document, mimetype: "application/pdf", fileName, caption: greeting });
      leads.markSent(ctx.state, lead.id, listing.id, ctx.sender, `أُرسل له عرض سعر للعقار #${listing.id} (${what})`);
      return ctx.reply(`📤 Offer for #${listing.id} (${what}) sent to #${lead.id} ${lead.name || ""} (+${lead.phone}).`);
    },
  },
];
