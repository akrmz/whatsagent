"use strict";

const { stopAll } = require("../services/automations");

/**
 * When the bot leaves or is removed from a group, its automatic posts there would keep
 * failing forever: stop them all.
 */
module.exports = {
  name: "bot-left-group",
  event: "group-participants.update",
  async run({ app, sock, log }, { id, participants, action }) {
    if (action !== "remove") return;
    const botIds = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).flatMap((b) => app.identity.aliases(b)));
    const botLeft = participants.some((p) => app.identity.aliases(typeof p === "string" ? p : p?.id).some((a) => botIds.has(a)));
    if (!botLeft) return;
    const stopped = stopAll(app.state, id, { all: true });
    app.groups.invalidate(id);
    if (stopped.length) log.info({ stopped }, "bot left a group; its automatic posts were stopped");
  },
};
