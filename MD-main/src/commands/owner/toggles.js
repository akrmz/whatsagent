"use strict";

const { files, groupData } = require("../../services/settings");

/** Builds an owner command that switches a global feature on or off. */
function toggleCommand({ name, aliases = [], store, label, description, permission = "owner" }) {
  return {
    name,
    aliases,
    category: "owner",
    description,
    usage: "on | off",
    permission,
    async run(ctx) {
      const s = store(ctx.state);
      const sub = (ctx.args[0] || "").toLowerCase();
      if (["on", "enable"].includes(sub) || ["off", "disable"].includes(sub)) {
        const value = ["on", "enable"].includes(sub);
        s.update((d) => (d.enabled = value));
        return ctx.reply(`✅ ${label} ${value ? "enabled" : "disabled"}.`);
      }
      return ctx.reply(`${label} is currently *${s.data.enabled ? "ON" : "OFF"}*.\nUse ${ctx.prefix}${name} on|off`);
    },
  };
}

module.exports = [
  toggleCommand({
    name: "autoread",
    store: files.autoread,
    label: "Auto-read",
    description: "Marks every incoming message as read (except ones that mention the bot).",
  }),
  toggleCommand({
    name: "autotyping",
    store: files.autotyping,
    label: "Auto-typing",
    description: "Shows a 'typing…' indicator when the bot receives messages.",
  }),
  toggleCommand({
    name: "anticall",
    store: files.anticall,
    label: "Anticall",
    description: "Rejects incoming calls and blocks the caller.",
  }),
  toggleCommand({
    name: "antidelete",
    store: files.antidelete,
    label: "Antidelete",
    description: "When someone deletes a message, sends you a copy (kept for 24 h, limited size).",
  }),
  {
    name: "autoreact",
    aliases: ["areact", "autoreaction"],
    category: "owner",
    description: "Reacts with ⏳ to every command message.",
    usage: "on | off",
    permission: "owner",
    async run(ctx) {
      const s = groupData(ctx.state);
      const sub = (ctx.args[0] || "").toLowerCase();
      if (sub === "on" || sub === "off") {
        s.update((d) => (d.autoReaction = sub === "on"));
        return ctx.reply(`✅ Auto-reactions ${sub === "on" ? "enabled" : "disabled"}.`);
      }
      return ctx.reply(`Auto-reactions are *${s.data.autoReaction ? "ON" : "OFF"}*.\nUse ${ctx.prefix}autoreact on|off`);
    },
  },
  {
    name: "autostatus",
    category: "owner",
    description: "Automatically views contacts' statuses, and optionally reacts to them with 💚.",
    usage: "on | off | react on|off",
    permission: "owner",
    async run(ctx) {
      const s = files.autoStatus(ctx.state);
      const [a, b] = ctx.args.map((x) => x.toLowerCase());
      if (a === "on" || a === "off") {
        s.update((d) => (d.enabled = a === "on"));
        return ctx.reply(`✅ Auto status view ${a === "on" ? "enabled" : "disabled"}.`);
      }
      if (a === "react" && (b === "on" || b === "off")) {
        s.update((d) => (d.reactOn = b === "on"));
        return ctx.reply(`✅ Status reactions ${b === "on" ? "enabled" : "disabled"}.`);
      }
      const p = ctx.prefix;
      return ctx.reply(
        `🔄 *Auto status*\n\nView: ${s.data.enabled ? "ON" : "OFF"}\nReact: ${s.data.reactOn ? "ON" : "OFF"}\n\n${p}autostatus on|off\n${p}autostatus react on|off`,
      );
    },
  },
  {
    name: "pmblocker",
    category: "owner",
    description: "Blocks anyone who is not owner/sudo and messages the bot privately (they get a notice first).",
    usage: "on | off | status | setmsg <text>",
    permission: "owner",
    async run(ctx) {
      const s = files.pmblocker(ctx.state);
      const sub = (ctx.args[0] || "").toLowerCase();
      if (sub === "on" || sub === "off") {
        s.update((d) => (d.enabled = sub === "on"));
        return ctx.reply(`✅ PM blocker ${sub === "on" ? "enabled" : "disabled"}.`);
      }
      if (sub === "setmsg") {
        const text = ctx.text.slice(6).trim();
        if (!text) return ctx.reply(`Usage: ${ctx.prefix}pmblocker setmsg <message>`);
        s.update((d) => (d.message = text.slice(0, 1000)));
        return ctx.reply("✅ PM blocker message updated.");
      }
      return ctx.reply(`PM blocker is *${s.data.enabled ? "ON" : "OFF"}*\nMessage: ${s.data.message}`);
    },
  },
];
