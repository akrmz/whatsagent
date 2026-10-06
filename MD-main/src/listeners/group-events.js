"use strict";

const { groupData } = require("../services/settings");
const greetings = require("../services/greetings");
const { at } = require("../services/targets");

const jidOf = (p) => (typeof p === "string" ? p : p?.id || p?.phoneNumber || "");

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
        await sock.sendMessage(id, await greetings.build(app, sock, { kind: key, user, meta, template: setting.message }));
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
