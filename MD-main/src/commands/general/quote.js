"use strict";

const { shizoText } = require("../../services/external");

module.exports = {
  name: "quote",
  category: "general",
  description: "Sends a random quote.",
  cooldown: 5,
  externalService: "shizoapi.onrender.com",

  async run(ctx) {
    return ctx.reply(await shizoText("quotes"));
  },
};
