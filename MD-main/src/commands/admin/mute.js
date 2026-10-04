"use strict";

const MAX_MINUTES = 7 * 24 * 60;

module.exports = [
  {
    name: "mute",
    category: "admin",
    description: "Only admins can send messages. Optionally unmute automatically after N minutes.",
    usage: "[minutes]",
    examples: [".mute", ".mute 30"],
    permission: "groupAdmin",
    botAdmin: true,

    async run(ctx) {
      const arg = ctx.args[0];
      const minutes = arg === undefined ? 0 : Number(arg);
      if (arg !== undefined && (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_MINUTES)) {
        return ctx.reply(`Give a whole number of minutes between 1 and ${MAX_MINUTES}, or nothing to mute until ${ctx.prefix}unmute.`);
      }
      await ctx.sock.groupSettingUpdate(ctx.chatId, "announcement");
      if (!minutes) return ctx.reply("🔇 The group has been muted.");
      const { sock, chatId } = ctx;
      const timer = setTimeout(async () => {
        try {
          const live = ctx.app.sock || sock;
          await live.groupSettingUpdate(chatId, "not_announcement");
          await live.sendMessage(chatId, { text: "🔊 The group has been unmuted." });
        } catch (err) {
          ctx.log.warn({ err: err.message }, "automatic unmute failed");
        }
      }, minutes * 60 * 1000);
      timer.unref();
      return ctx.reply(`🔇 The group has been muted for ${minutes} minute(s). (A bot restart cancels the automatic unmute.)`);
    },
  },
  {
    name: "unmute",
    category: "admin",
    description: "Lets everyone send messages again.",
    permission: "groupAdmin",
    botAdmin: true,

    async run(ctx) {
      await ctx.sock.groupSettingUpdate(ctx.chatId, "not_announcement");
      return ctx.reply("🔊 The group has been unmuted.");
    },
  },
];
