"use strict";

const { getJson } = require("../../core/http");

module.exports = {
  name: "joke",
  category: "general",
  description: "Sends a random dad joke.",
  cooldown: 5,
  externalService: "icanhazdadjoke.com",

  async run(ctx) {
    const data = await getJson("https://icanhazdadjoke.com/");
    return ctx.reply(data.joke || "No joke today.");
  },
};
