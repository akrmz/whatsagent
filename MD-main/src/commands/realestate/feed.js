"use strict";

const re = require("../../services/realestate");
const feed = require("../../services/feed");
const requests = require("../../services/requests");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#?f?/i, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const ago = (t) => {
  const h = Math.floor((Date.now() - t) / 3600000);
  return h < 1 ? "الآن" : h < 24 ? `منذ ${h} ساعة` : `منذ ${Math.floor(h / 24)} يوم`;
};

/** Offers in the feed matching the same filters as .listings (type, sale/rent, price, rooms, area words). */
function searchOffers(state, query) {
  const items = new Map(feed.all(state, "offer").map((i) => [`F${i.id}`, i]));
  const { list } = re.search(state, query, [...items.values()].map(feed.asListing));
  return list.map((l) => items.get(l.id));
}

function show(ctx, item) {
  const g = feed.watched(ctx.state, item.chat)?.name || "جروب";
  const m = feed.matchesFor(ctx.state, item);
  const cur = re.agent(ctx.state).currency;
  const match =
    item.kind === "offer"
      ? m.length
        ? `🎯 يناسب: ${m.map(({ lead }) => `#${lead.id} ${lead.name || ""}`.trim()).join("، ")}`
        : "لا يناسب أحداً من عملائك حالياً"
      : m.length
        ? `🏠 عندك: ${m.map(({ listing }) => `#${listing.id}`).join("، ")}`
        : "لا يوجد عندك عقار مطابق";
  return [
    `${item.kind === "offer" ? "🏷️ *عرض*" : "🔎 *طلب*"} F${item.id} — "${g}" — ${ago(item.at)}`,
    `👤 ${item.name || "سمسار"}${item.poster ? ` (+${item.poster})` : ""}`,
    item.kind === "request" ? `المطلوب: ${requests.describe(item.fields, cur)}` : null,
    "",
    item.text,
    "",
    match,
    item.kind === "offer" ? `\nأضفه لكتالوجك (مشاركة مع السمسار): ${ctx.prefix}feed add ${item.id}` : null,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

module.exports = [
  {
    name: "watch",
    aliases: ["brokergroup", "rasd"],
    category: "realestate",
    description:
      "رصد جروب السماسرة — in a brokers' group: \"on\" makes the bot read other brokers' posts here. Offers (a property with a price) go into your feed (.feed); you get a private message when an offer suits your saved clients, or a request (\"مطلوب شقة …\") matches your listings. The bot never posts in the group. Reposts within a week are ignored; posts are kept 30 days. Owner and sudo users.",
    usage: "on | off",
    examples: [".watch on", ".watch off", ".watch"],
    permission: "sudo",
    groupOnly: true,
    cooldown: 3,
    async run(ctx) {
      const v = (ctx.args[0] || "").toLowerCase();
      if (v === "on") {
        const meta = await ctx.groupMetadata().catch(() => null);
        feed.watch(ctx.state, ctx.chatId, meta?.subject || "", ctx.sender);
        return ctx.reply("👀 Watching this group: brokers' offers go to your feed (.feed), and you get a private message when one suits your clients or a request matches your listings. Nothing is posted here.");
      }
      if (v === "off") {
        feed.unwatch(ctx.state, ctx.chatId);
        return ctx.reply("🙈 No longer watching this group. Saved posts stay in .feed until they're 30 days old.");
      }
      return ctx.reply(`Watching this group: ${feed.watched(ctx.state, ctx.chatId) ? "on" : "off"}\n${ctx.prefix}watch on | off`);
    },
  },
  {
    name: "feed",
    clientData: true,
    aliases: ["brokerfeed", "souk"],
    category: "realestate",
    description:
      "عروض وطلبات السماسرة — brokers' offers and requests from the groups you watch (.watch on), last 30 days: search offers with the .listings filters, \"requests\" for what brokers are looking for, a number for the full post and the broker's number, \"add\" to copy an offer into your catalogue as a shared listing. Owner and sudo users.",
    usage: "[filters] | requests | <number> | add <number> | groups",
    examples: [".feed", ".feed شقة التجمع 2m-4m", ".feed requests", ".feed 12", ".feed add 12"],
    permission: "sudo",
    cooldown: 3,
    async run(ctx) {
      const [sub = "", arg = ""] = ctx.args.map((a) => a.toLowerCase());
      const cur = re.agent(ctx.state).currency;
      const direct = ctx.args.length === 1 && idOf(sub);
      if (direct) {
        const item = feed.get(ctx.state, direct);
        return ctx.reply(item ? show(ctx, item) : `There is no post F${direct} in the feed (posts are kept ${feed.KEEP_DAYS} days).`);
      }
      if (sub === "groups") {
        const gs = Object.entries(feed.groups(ctx.state));
        return ctx.reply(gs.length ? `👀 *Watched groups*\n${gs.map(([, g]) => `▫️ ${g.name || "—"}`).join("\n")}\n\nIn a group: ${ctx.prefix}watch off` : `No group is watched. In a brokers' group: ${ctx.prefix}watch on`);
      }
      if (sub === "add" || sub === "import") {
        const item = feed.get(ctx.state, idOf(arg));
        if (!item || item.kind !== "offer") throw new UserError(`Which offer? ${ctx.prefix}feed add <number> (from ${ctx.prefix}feed)`);
        const source = `مشاركة مع السمسار ${item.name || ""}${item.poster ? ` +${item.poster}` : ""} (F${item.id})`.replace(/\s+/g, " ");
        const notes = [item.fields.notes, source].filter(Boolean).join("\n");
        const l = re.add(ctx.state, { ...item.fields, notes }, ctx.sender);
        return ctx.reply(`✅ Added as *#${l.id}* (shared with the broker; noted on the listing)\n\n${re.card(l, re.agent(ctx.state))}`);
      }
      if (sub === "requests" || sub === "طلبات") {
        const list = feed.all(ctx.state, "request").slice(0, 15);
        if (!list.length) return ctx.reply(`No brokers' requests yet${Object.keys(feed.groups(ctx.state)).length ? "" : ` (no group is watched: ${ctx.prefix}watch on in a brokers' group)`}.`);
        const lines = list.map((i) => {
          const n = feed.matchesFor(ctx.state, i).length;
          return `*F${i.id}* ${requests.describe(i.fields, cur)} — ${ago(i.at)}${n ? ` · 🏠 عندك ${n}` : ""}`;
        });
        return ctx.reply(`🔎 *طلبات السماسرة* (${list.length})\n\n${lines.join("\n")}\n\n${ctx.prefix}feed <number> for the post and the broker`);
      }
      const offers = searchOffers(ctx.state, ctx.text);
      if (!offers.length) return ctx.reply(feed.all(ctx.state, "offer").length ? "No offer in the feed matches. Try fewer filters." : `The feed is empty. In a brokers' group: ${ctx.prefix}watch on`);
      const lines = offers.slice(0, 15).map((i) => {
        const n = feed.matchesFor(ctx.state, i).length;
        return `${re.line(feed.asListing(i), cur)} — ${ago(i.at)}${n ? ` · 🎯 ${n}` : ""}`;
      });
      return ctx.reply(`🏷️ *عروض السماسرة* (${offers.length}${offers.length > 15 ? `، أول 15` : ""})\n\n${lines.join("\n")}\n\n${ctx.prefix}feed <number> for the post and the broker · 🎯 = clients it suits`);
    },
  },
];
