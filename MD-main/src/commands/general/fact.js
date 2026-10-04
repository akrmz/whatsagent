"use strict";

const { getJson } = require("../../core/http");

module.exports = {
  name: "fact",
  category: "general",
  description: "Sends a random useless fact.",
  cooldown: 5,
  externalService: "uselessfacts.jsph.pl",

  async run(ctx) {
    const data = await getJson("https://uselessfacts.jsph.pl/random.json?language=en");
    return ctx.reply(data.text || "No fact available right now.");
  },
};
