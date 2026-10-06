"use strict";

const levels = require("../../services/levels");
const cards = require("../../services/cards");
const { at } = require("../../services/targets");

module.exports = [
  {
    name: "rank",
    aliases: ["level", "xp"],
    category: "games",
    description: "Shows your level card in this group (or someone else's): level, rank and XP. Members earn XP by chatting (once a minute).",
    usage: "[@user]",
    groupOnly: true,
    cooldown: 10,
    async run(ctx) {
      const user = ctx.target() || ctx.sender;
      const s = levels.stats(ctx.state, ctx.chatId, user);
      if (!s.xp) return ctx.reply({ text: `${at(user)} has no XP here yet. Chat a bit first!`, mentions: [user] });
      const name = user === ctx.sender && ctx.senderName ? ctx.senderName : at(user);
      const image = await cards.rankCard({ avatar: await cards.avatarOf(ctx.sock, user), name, level: s.level, rank: s.rank, current: s.current, needed: s.needed, xp: s.xp });
      return ctx.reply({ image, caption: `${at(user)} · level ${s.level} · rank #${s.rank}`, mentions: [user] });
    },
  },
  {
    name: "leaderboard",
    aliases: ["lb", "top", "levels"],
    category: "games",
    description: "The 10 most active members of this group by XP.",
    groupOnly: true,
    cooldown: 10,
    async run(ctx) {
      const list = levels.top(ctx.state, ctx.chatId);
      if (!list.length) return ctx.reply("Nobody has XP here yet.");
      const medals = ["🥇", "🥈", "🥉"];
      const lines = list.map((e, i) => `${medals[i] || `${i + 1}.`} ${at(e.user)} — level ${e.level} (${e.xp} XP)`);
      return ctx.reply({ text: `🏆 *Leaderboard*\n\n${lines.join("\n")}`, mentions: list.map((e) => e.user) });
    },
  },
  {
    name: "levelup",
    aliases: ["levelmsg"],
    category: "admin",
    description: "Turns level-up announcements in this group on or off (XP is always counted). \".levelup reset\" clears all levels here.",
    usage: "on | off | reset",
    permission: "groupAdmin",
    cooldown: 3,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      if (sub === "on" || sub === "off") {
        levels.setAnnounce(ctx.state, ctx.chatId, sub === "on");
        return ctx.reply(`✅ Level-up messages are now ${sub.toUpperCase()}.`);
      }
      if (sub === "reset") {
        levels.reset(ctx.state, ctx.chatId);
        return ctx.reply("🧹 All levels in this group were reset.");
      }
      return ctx.reply(`Level-up messages: ${levels.announces(ctx.state, ctx.chatId) ? "ON" : "OFF"}\nUsage: ${ctx.prefix}levelup on | off | reset`);
    },
  },
];
