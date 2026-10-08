"use strict";

const re = require("../services/realestate");
const catalog = require("../services/catalogmenu");

/**
 * With ".agent catalog on": clients browse the listings from a menu in a private chat
 * ("عقارات", then a number). Runs before written requests, so "عقارات" isn't read as one.
 */
module.exports = {
  name: "catalog-menu",
  event: "message",
  phase: "post",
  priority: 21.5,
  publicOnly: true,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe || !re.agent(ctx.state).catalog || !ctx.body) return undefined;
    return (await catalog.handle(ctx)) ? "stop" : undefined;
  },
};
