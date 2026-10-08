"use strict";

const weekly = require("../../services/weekly");

module.exports = {
  name: "weekly",
  aliases: ["week", "osbou", "weekreport"],
  category: "realestate",
  description:
    "ملخص الأسبوع — the last 7 days against the 7 before: new clients by source, messages sent to clients and their replies, viewings booked and how they went, deals and commission, new listings and price cuts. Also part of the morning summary on Saturdays. Owner and sudo users.",
  examples: [".weekly"],
  permission: "sudo",
  cooldown: 5,
  run: (ctx) => ctx.reply(weekly.build(ctx.state, ctx.config.bot.timezone)),
};
