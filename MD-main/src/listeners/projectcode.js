"use strict";

const re = require("../services/realestate");
const projects = require("../services/projects");
const { allowLookup } = require("../services/lookuplimits");

/**
 * "P3" (or "#P3", "P3 en") shows a developer's project in any chat, like "#12" for a listing,
 * with the same flood limits.
 */
module.exports = {
  name: "project-code",
  event: "message",
  phase: "post",
  priority: 21.2,
  publicOnly: true,
  async run(ctx) {
    const m = re.latinDigits(ctx.body.trim()).match(/^#?\s?[Pp]\s?(\d{1,4})(?:\s+(en|english))?$/);
    if (!m) return undefined;
    const p = projects.get(ctx.state, Number(m[1]));
    if (!p) return undefined;
    if (!allowLookup(ctx, `project:${p.id}`)) return "stop"; // flood: silent
    const a = re.agent(ctx.state);
    await ctx.reply(m[2] ? projects.cardEn(p, a) : projects.card(p, a));
    return "stop";
  },
};
