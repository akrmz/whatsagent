"use strict";

const { getImage } = require("../../services/external");
const { assertSafeUrl } = require("../../core/http");
const { UserError } = require("../../core/errors");

module.exports = {
  name: "ss",
  aliases: ["ssweb", "screenshot"],
  category: "general",
  description: "Takes a screenshot of a public website.",
  usage: "<url>",
  examples: [".ss https://example.com"],
  cooldown: 20,
  externalService: "api.siputzx.my.id (the URL is sent to this service)",

  async run(ctx) {
    if (!ctx.text) return ctx.reply(`*SCREENSHOT*\n\n${ctx.prefix}ss <url>\nExample: ${ctx.prefix}ss https://google.com`);
    let url;
    try {
      url = assertSafeUrl(ctx.args[0], { allowHttp: true }).toString();
    } catch {
      throw new UserError("Please provide a valid public http(s) URL.");
    }
    await ctx.react("📸");
    const qs = new URLSearchParams({ url, theme: "light", device: "desktop" });
    const image = await getImage(`https://api.siputzx.my.id/api/tools/ssweb?${qs}`, { timeoutMs: 60000 });
    return ctx.reply({ image });
  },
};
