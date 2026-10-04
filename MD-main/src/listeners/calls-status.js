"use strict";

const { files } = require("../services/settings");
const { LRU } = require("../core/lru");

const notified = new LRU({ max: 2000, ttlMs: 60 * 1000 });

module.exports = [
  {
    name: "anticall",
    event: "call",
    async run({ app, sock, log }, calls) {
      if (!files.anticall(app.state).data.enabled) return;
      for (const call of calls) {
        if (call.status !== "offer" || !call.from) continue;
        if (app.permissions.isOwner(call.from)) continue;
        await sock.rejectCall(call.id, call.from).catch((err) => log.debug({ err: err.message }, "rejectCall failed"));
        if (!notified.get(call.from)) {
          notified.set(call.from, true);
          await sock.sendMessage(call.from, { text: "📵 Calls are not accepted. Your call was rejected and you have been blocked." }).catch(() => {});
        }
        setTimeout(() => sock.updateBlockStatus(call.from, "block").catch(() => {}), 800).unref();
      }
    },
  },
  {
    name: "autostatus",
    event: "status",
    async run({ app, sock }, msg) {
      const s = files.autoStatus(app.state).data;
      if (!s.enabled || msg.key.fromMe) return;
      await new Promise((r) => setTimeout(r, 1000));
      await sock.readMessages([msg.key]);
      if (s.reactOn && msg.key.participant) {
        await sock.sendMessage(
          "status@broadcast",
          { react: { text: "💚", key: msg.key } },
          { statusJidList: [msg.key.participant, sock.user.id.replace(/:\d+@/, "@")] },
        );
      }
    },
  },
];
