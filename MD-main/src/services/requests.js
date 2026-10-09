"use strict";

const re = require("./realestate");
const leads = require("./leads");
const rotation = require("./rotation");
const projects = require("./projects");
const { limiterFor } = require("../core/ratelimit");

/**
 * Clients' requests written as a message (".agent requests on"): "عايز شقة في التجمع 3 غرف
 * ميزانية 3 مليون" in a private chat is saved on the client (new or existing), answered with
 * the closest available listings, and the agent is told. Strangers trigger it, so it is limited.
 */

const MAX_SHOWN = 3;
// Asking, not offering: a broker's post ("يوجد شقة للبيع … بسعر") must not read as a request.
const WANT = /(?<![\p{L}])(?:عايز|عاوز|عايزه|عاوزه|عايزة|عاوزة|عايزين|عاوزين|محتاج|محتاجه|محتاجة|محتاجين|بدور|بدوّر|ابحث|أبحث|بابحث|مطلوب|مطلوبة|مطلوبه|مطلوبين|اريد|أريد|نريد|looking for|i want|i need|we need)(?![\p{L}])/iu;
// "فيه/عندك …" asks only as a question, or without the marks of an offer ("فيه شقة للبيع … بسعر 3 مليون" is a broker's post).
const MAYBE = /(?<![\p{L}])(?:حد عنده|عندك|عندكم|عندكو|فيه|في حاجة)(?![\p{L}])/iu;
const OFFER = /(?<![\p{L}])(?:بسعر|السعر|المطلوب|بمقدم|مقدم|تقسيط|اقساط|أقساط|استلام|متر|م²|م2)(?![\p{L}])/iu;
const asks = (t) => WANT.test(t) || /[؟?]/.test(t) || (MAYBE.test(t) && !OFFER.test(re.latinDigits(t)));
const WISH_FIELDS = ["type", "deal", "location", "rooms", "min", "max", "downMax", "features"];

const perClient = (state, key) => limiterFor(state, "request-client", { max: 1, windowMs: 10 * 60 * 1000 })(key); // one answer per client per 10 min
const newClients = (state) => limiterFor(state, "inquiry-new", { max: 30, windowMs: 3600 * 1000, size: 1 })("all"); // shared with #12 inquiries
const notifyOwner = (state, key) => limiterFor(state, "request-notify", { max: 1, windowMs: 3600 * 1000 })(key);

/**
 * What a message asks for, or null if it isn't a property request: it needs a property type
 * and a word of asking ("عايز", "عندك", "?" …), and isn't a long post.
 * @returns {{ type, deal?, location?, rooms?, min?, max? } | null}
 */
function detect(text) {
  const t = String(text || "").trim();
  if (t.length < 6 || t.length > 300 || t.split("\n").length > 4) return null;
  if (!asks(t)) return null;
  if (require("./sellers").isSellerIntent(t)) return null; // "عندي شقة عايز أبيعها" is a seller, not a buyer
  const f = leads.parseLeadText(t);
  if (!f.type) return null;
  const wish = {};
  for (const k of WISH_FIELDS) if (f[k] !== undefined) wish[k] = f[k];
  return wish;
}

/** "شقة للبيع في التجمع، 3 غرف، حتى 3 مليون" */
const describe = (w, cur) =>
  [`${w.type}${w.deal ? ` لل${w.deal}` : ""}`, w.location && `في ${w.location}`, w.rooms && `${w.rooms} غرف`, w.features?.length && w.features.join(" و"), leads.budgetText(w, cur)].filter(Boolean).join("، ");

/**
 * Saves the request and answers it. @returns {Promise<{ lead, matches, isNew } | { limited: true } | null>}
 * null when the message isn't a request; { limited } when it is but a limit was reached (nothing is sent).
 */
async function handle(ctx) {
  const wish = detect(ctx.body);
  if (!wish) return null;
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  if (!perClient(ctx.state, phone || ctx.sender)) return { limited: true };
  const cur = re.agent(ctx.state).currency;
  const what = describe(wish, cur);

  let lead = leads.byPhone(ctx.state, phone);
  const isNew = !lead;
  if (lead) {
    leads.update(ctx.state, lead.id, wish);
    lead = leads.note(ctx.state, lead.id, ctx.sender, `طلب: ${what}`);
  } else {
    if (!newClients(ctx.state)) {
      ctx.log.warn("requests: more than 30 new clients in an hour; not saving more for now");
      return { limited: true };
    }
    try {
      lead = leads.add(ctx.state, { name: (ctx.senderName || "").slice(0, 60) || undefined, phone: phone || undefined, ...wish, source: "واتساب", notes: `طلب: ${String(ctx.body).trim().slice(0, 300)}` }, ctx.sender);
      if (rotation.assignNext(ctx.app, lead.id)) lead = leads.get(ctx.state, lead.id); // the team member whose turn it is
    } catch (err) {
      ctx.log.warn({ err: err.message }, "requests: client not saved");
      return null;
    }
  }

  // The answer follows what they just asked (the saved client may have older wishes too).
  const matches = leads.matchingListings(ctx.state, wish).slice(0, MAX_SHOWN);
  // New projects sold in instalments that fit too (for buyers; at most 2).
  const plans = projects.forWish(ctx.state, wish).slice(0, 2);
  const plansText = plans.length ? `\n\n🏗️ ${matches.length ? "ومشروعات جديدة بالتقسيط تناسبك" : "مشروعات جديدة بالتقسيط تناسبك"}:\n${plans.map((p) => projects.line(p, cur)).join("\n")}` : "";
  const hi = lead.name ? `أهلاً ${lead.name} 👋` : "أهلاً 👋";
  await ctx.reply(
    matches.length
      ? `${hi}\nدي أقرب العقارات المتاحة لطلبك (${what}):\n\n${matches.map(({ listing }) => re.line(listing, cur)).join("\n")}${plansText}\n\nأرسل رقم العقار (مثلاً #${matches[0].listing.id}) للتفاصيل والصور.`
      : plans.length
        ? `${hi}\nوصلني طلبك (${what}) 👍${plansText}\n\nهتواصل معاك بالتفاصيل وخطط السداد.`
        : `${hi}\nوصلني طلبك (${what}) 👍\nحالياً مفيش عقار مطابق، وهتواصل معاك أول ما يتوفر.`,
  );
  // Remembered as sent: campaigns won't send them again, and the summary shows if the client answers.
  if (matches.length) {
    const ids = matches.map(({ listing }) => listing.id);
    leads.markSent(ctx.state, lead.id, ids, "bot", `أُرسل له تلقائياً: ${ids.map((i) => `#${i}`).join("، ")}`);
  }

  const owner = ctx.config.owners.numbers[0];
  if (owner && notifyOwner(ctx.state, String(lead.id))) {
    const who = `${lead.name || "عميل"}${phone ? ` (+${phone})` : ""}`;
    const found = [matches.length ? `أرسلت له ${matches.length}: ${matches.map(({ listing }) => `#${listing.id}`).join("، ")}` : "لا يوجد عقار مطابق", plans.length && `🏗️ مشروعات: ${plans.map((p) => `P${p.id}`).join("، ")}`].filter(Boolean).join("\n");
    await ctx.sock.sendMessage(rotation.notifyJid(ctx.app, lead), { text: `🔔 ${isNew ? "طلب من عميل جديد" : "طلب جديد"}: ${who}\n🔎 ${what}\n${found}\n${ctx.prefix}lead ${lead.id}` }).catch(() => {});
  }
  return { lead, matches, isNew };
}

module.exports = { detect, describe, handle };
