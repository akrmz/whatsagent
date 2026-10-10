"use strict";

const re = require("../../services/realestate");
const feed = require("../../services/feed");
const requests = require("../../services/requests");
const wanted = require("../../services/wanted");
const drafts = require("../../services/drafts");
const { ownerLine } = require("../../services/listingview");
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
      "رصد جروب السماسرة — in a brokers' group: \"on\" makes the bot read other brokers' posts here. Offers (a property with a price) go into your feed (.feed); you get a private message when an offer suits your saved clients, or a request (\"مطلوب شقة …\") matches your listings. The bot never posts in the group by itself (only .wanted post, when you send it). Reposts within a week are ignored; posts are kept 30 days. Owner and sudo users.",
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
        // B-28: the broker (name, number, and numbers in their post) is kept privately, as a draft's
        // source, never in the notes that clients see on the card.
        const owner = ctx.config.owners.numbers[0];
        const { clean, contacts } = drafts.splitContacts(item.fields.notes || "", owner);
        const phones = [...new Set([item.poster, ...contacts].filter(Boolean))].slice(0, 3);
        const source = { kind: "feed", ...(item.name ? { name: item.name } : {}), ...(phones.length ? { phones } : {}), feed: item.id, at: Date.now() };
        const l = re.add(ctx.state, { ...item.fields, notes: clean || undefined, source }, ctx.sender);
        return ctx.reply(`✅ Added as *#${l.id}* (shared with the broker, who is kept privately on it)\n\n${re.card(l, re.agent(ctx.state))}${ownerLine(ctx, l)}`);
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
  {
    name: "wanted",
    aliases: ["matloob", "demand"],
    category: "realestate",
    description:
      "مطلوب لعملائك — what your active clients want that nothing in your catalogue matches, grouped by type, sale/rent and area (how many clients, the highest budget, rooms and must-haves), and a ready \"مطلوب\" post for brokers' groups. The post names no client: only what is wanted and your contact. “post” sends it to the brokers' groups you watch (.watch on), each at most once a day; “post here” in a group sends it there. Brokers' offers in answer come into your feed, which tells you which clients they suit. Owner and sudo users.",
    usage: "[post | post here]",
    examples: [".wanted", ".wanted post", ".wanted post here"],
    permission: "sudo",
    cooldown: 5,
    async run(ctx) {
      const p = ctx.prefix;
      const list = wanted.gaps(ctx.state);
      if (!list.length) return ctx.reply("✅ Every active client who said what they want has at least one matching listing. Nothing to ask brokers for.");
      const post = wanted.postText(ctx.state, list);
      const [sub = "", where = ""] = ctx.args.map((a) => a.toLowerCase());
      if (sub === "post" || sub === "نشر") {
        if (where === "here" || where === "هنا") {
          if (!ctx.isGroup) throw new UserError(`In a brokers' group: ${p}wanted post here. From here: ${p}wanted post (to the groups you watch).`);
          if (!wanted.dueGroups(ctx.state).some(([chat]) => chat === ctx.chatId) && feed.watched(ctx.state, ctx.chatId)) throw new UserError("Already posted in this group in the last 24 hours.");
          await ctx.send(post);
          wanted.markPosted(ctx.state, ctx.chatId);
          return undefined;
        }
        const watchedGroups = Object.keys(feed.groups(ctx.state));
        if (!watchedGroups.length) return ctx.reply(`No brokers' groups watched yet. In each one: ${p}watch on — then ${p}wanted post here, or ${p}wanted post from here.`);
        const due = wanted.dueGroups(ctx.state).slice(0, 10);
        if (!due.length) return ctx.reply("Every watched group already had the post in the last 24 hours.");
        const done = [];
        for (const [chat, g] of due) {
          try {
            await ctx.sock.sendMessage(chat, { text: post });
            wanted.markPosted(ctx.state, chat);
            done.push(g.name || chat);
          } catch (err) {
            ctx.log.warn({ err: err.message }, "wanted post not sent");
          }
        }
        return ctx.reply(`📤 "مطلوب" posted in ${done.length} group(s): ${done.join("، ")}
Brokers' offers in answer come to you as usual (${p}feed).`);
      }
      const cur = re.agent(ctx.state).currency || "جنيه";
      return ctx.reply(
        [
          `🔎 *Wanted by your clients, with nothing matching* (${list.length})`,
          "",
          ...list.slice(0, 15).map((g) => `${wanted.line(g, cur)} — 👥 ${g.count}`),
          "",
          "*The post* (no client is named):",
          post,
          "",
          `Send it to your watched brokers' groups: ${p}wanted post · in one group: ${p}wanted post here`,
        ].join("\n"),
      );
    },
  },
];
