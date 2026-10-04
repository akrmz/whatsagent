"use strict";

const { groupData } = require("../services/settings");
const { someRandomApi } = require("../services/external");
const { at } = require("../services/targets");

const jidOf = (p) => (typeof p === "string" ? p : p?.id || p?.phoneNumber || "");

async function welcomeCard(sock, user, meta, type) {
  let avatar = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Default_pfp.jpg/240px-Default_pfp.jpg";
  try {
    avatar = (await sock.profilePictureUrl(user, "image")) || avatar;
  } catch {
    /* no profile picture */
  }
  return someRandomApi(`welcome/img/2/${type === "join" ? "gaming3" : "gaming1"}`, {
    type,
    textcolor: type === "join" ? "green" : "red",
    username: user.split("@")[0],
    guildName: meta.subject.slice(0, 50),
    memberCount: String(meta.participants.length),
    avatar,
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
          const image = await welcomeCard(sock, user, meta, action === "add" ? "join" : "leave");
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
