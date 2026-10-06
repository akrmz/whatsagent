"use strict";

const captcha = require("../../services/captcha");

module.exports = {
  name: "captcha",
  aliases: ["verify", "antibot"],
  category: "admin",
  description:
    "New members who join by link must answer a small sum within a few minutes, or the bot removes them (stops spam bots). Their messages are deleted until they answer. Members added by an admin skip it.",
  usage: "on | off | time <1-10 minutes>",
  examples: [".captcha on", ".captcha time 5", ".captcha off"],
  permission: "groupAdmin",
  botAdmin: true,
  cooldown: 3,
  async run(ctx) {
    const [sub, value] = ctx.args.map((a) => a.toLowerCase());
    const s = captcha.get(ctx.state, ctx.chatId);
    const show = (x) => `🤖 Captcha: ${x?.enabled ? "ON" : "OFF"}${x?.enabled ? ` · ${x.minutes || 3} min to answer` : ""}`;
    if (sub === "on" || sub === "off") return ctx.reply(`✅ ${show(captcha.set(ctx.state, ctx.chatId, { enabled: sub === "on" }))}`);
    if (sub === "time") {
      const minutes = Number(value);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10) return ctx.reply(`Usage: ${ctx.prefix}captcha time <1-10>`);
      return ctx.reply(`✅ ${show(captcha.set(ctx.state, ctx.chatId, { minutes }))}`);
    }
    return ctx.reply(`${show(s)}\n\n${ctx.prefix}captcha on | off | time 5`);
  },
};
