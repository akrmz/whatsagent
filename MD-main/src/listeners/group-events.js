"use strict";

const { groupData } = require("../services/settings");
const cards = require("../services/cards");
const { at } = require("../services/targets");

const jidOf = (p) => (typeof p === "string" ? p : p?.id || p?.phoneNumber || "");

// Drawn on the server (services/cards.js): the member's photo is not sent to any third party.
async function welcomeCard(sock, user, meta, type, phoneJid) {
  return cards.welcomeCard({
    avatar: await cards.avatarOf(sock, user),
    kind: type === "join" ? "welcome" : "goodbye",
    // LID-only members have no phone number to show; then just the photo and group.
    name: phoneJid?.endsWith("@s.whatsapp.net") ? `+${phoneJid.split("@")[0]}` : type === "join" ? "New member" : "A member",
    group: meta.subject || "",
    members: meta.participants?.length || 0,
  });
}

function fill(template, { user, meta }) {
  return template
    .replace(/{user}/g, at(user))
    .replace(/{group}/g, meta.subject)
    .replace(/{description}/g, meta.desc?.toString() || "");
}

module.exports = [
  {
    name: "welcome-goodbye",
    event: "group-participants.update",
    async run({ app, sock }, { id, participants, action }) {
      if (action !== "add" && action !== "remove") return;
      const key = action === "add" ? "welcome" : "goodbye";
      const setting = groupData(app.state).data[key][id];
      if (!setting?.enabled) return;
      const meta = await app.groups.get(sock, id);
      for (const p of participants) {
        const user = jidOf(p);
        if (!user) continue;
        const text = fill(setting.message || (key === "welcome" ? "Welcome {user} to {group}! 🎉" : "Goodbye {user} 👋"), { user, meta });
        try {
          const image = await welcomeCard(sock, user, meta, action === "add" ? "join" : "leave", app.identity.toPn(user) || user);
          await sock.sendMessage(id, { image, caption: text, mentions: [user] });
        } catch {
          await sock.sendMessage(id, { text, mentions: [user] });
        }
      }
    },
  },
  {
    name: "promote-demote-announce",
    event: "group-participants.update",
    async run({ app, sock }, { id, participants, action, author }) {
      if ((action !== "promote" && action !== "demote") || !app.state.isPublic()) return;
      const users = participants.map(jidOf).filter(Boolean);
      const by = jidOf(author);
      const title = action === "promote" ? "GROUP PROMOTION" : "GROUP DEMOTION";
      await sock.sendMessage(id, {
        text: `*『 ${title} 』*\n\n${users.map((u) => `• ${at(u)}`).join("\n")}\n\nBy: ${by ? at(by) : "System"}`,
        mentions: [...users, by].filter(Boolean),
      });
    },
  },
];
