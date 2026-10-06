"use strict";

const { groupData } = require("../../services/settings");
const greetings = require("../../services/greetings");

const { DEFAULTS } = greetings;

function greetingCommand(key, label, variables) {
  return {
    name: key,
    category: "admin",
    description: `${label} messages when members ${key === "welcome" ? "join" : "leave"}. Variables: ${variables}.`,
    usage: "on | off | set <message> | test",
    examples: [`.${key} on`, `.${key} set ${DEFAULTS[key]}`, `.${key} test`],
    permission: "groupAdmin",

    async run(ctx) {
      const store = groupData(ctx.state);
      const sub = (ctx.args[0] || "").toLowerCase();
      const current = store.data[key][ctx.chatId];
      const p = ctx.prefix;
      if (sub === "on") {
        if (current?.enabled) return ctx.reply(`⚠️ ${label} messages are already enabled.`);
        store.update((d) => (d[key][ctx.chatId] = { enabled: true, message: current?.message || DEFAULTS[key] }));
        return ctx.reply(`✅ ${label} messages enabled. Use *${p}${key} set <message>* to customize.`);
      }
      if (sub === "off") {
        if (!current?.enabled) return ctx.reply(`⚠️ ${label} messages are already disabled.`);
        store.update((d) => delete d[key][ctx.chatId]);
        return ctx.reply(`✅ ${label} messages disabled.`);
      }
      if (sub === "test") {
        // Preview with yourself as the member, exactly as it will be sent.
        const meta = await ctx.groupMetadata();
        return ctx.send(await greetings.build(ctx.app, ctx.sock, { kind: key, user: ctx.sender, meta, template: current?.message }));
      }
      if (sub === "set") {
        const message = ctx.text.slice(3).trim();
        if (!message) return ctx.reply(`⚠️ Usage: ${p}${key} set <message>`);
        store.update((d) => (d[key][ctx.chatId] = { enabled: true, message: message.slice(0, 1000) }));
        return ctx.reply(`✅ Custom ${label.toLowerCase()} message saved and enabled.`);
      }
      return ctx.reply(
        `*${label} setup*\n\n${p}${key} on\n${p}${key} set <message>\n${p}${key} test  (preview)\n${p}${key} off\n\nVariables: ${variables}\nStatus: ${current?.enabled ? "ON" : "OFF"}`,
      );
    },
  };
}

module.exports = [
  greetingCommand("welcome", "Welcome", "{user}, {group}, {description}, {count}"),
  greetingCommand("goodbye", "Goodbye", "{user}, {group}, {count}"),
];
