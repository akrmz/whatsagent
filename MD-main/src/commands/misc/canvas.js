"use strict";

const { someRandomApi, avatarOrImageUrl } = require("../../services/external");
const { resolveTargets, at } = require("../../services/targets");

/**
 * Image effects from some-random-api.com. They use, in order: an image in or replied to
 * by the message, else the profile picture of the mentioned/replied user, else yours.
 */

const EXTERNAL = "api.some-random-api.com (the picture or profile photo URL is sent; message images are first uploaded to a PUBLIC host)";
const base = { category: "misc", cooldown: 10, usage: "[@user | image]", externalService: EXTERNAL };

function avatarEffect(name, pathname, description, aliases = []) {
  return {
    ...base,
    name,
    aliases,
    description,
    async run(ctx) {
      const avatar = await avatarOrImageUrl(ctx);
      const image = await someRandomApi(pathname, { avatar });
      const who = resolveTargets(ctx, { allowNumbers: false })[0];
      return ctx.reply(who ? { image, caption: at(who), mentions: [who] } : { image });
    },
  };
}

function textEffect(name, pathname, description, { usage, fields, aliases = [], defaults = {} }) {
  return {
    ...base,
    name,
    aliases,
    description,
    usage,
    async run(ctx) {
      // "field?" marks an optional field.
      const specs = fields.map((f) => ({ key: f.replace(/\?$/, ""), optional: f.endsWith("?") }));
      const values = specs.length === 1 ? [ctx.text] : ctx.text.split("|").map((s) => s.trim());
      const params = {};
      specs.forEach((s, i) => {
        const v = (values[i] || defaults[s.key] || "").slice(0, 200);
        if (v) params[s.key] = v;
      });
      if (specs.some((s) => !s.optional && !params[s.key])) return ctx.reply(`Usage: ${ctx.prefix}${name} ${usage}`);
      params.avatar = await avatarOrImageUrl(ctx);
      return ctx.reply({ image: await someRandomApi(pathname, params) });
    },
  };
}

module.exports = [
  avatarEffect("heart", "canvas/misc/heart", "Puts the picture in a heart."),
  avatarEffect("horny", "canvas/misc/horny", "Makes a joke 'horny licence' card."),
  avatarEffect("circle", "canvas/misc/circle", "Crops the picture into a circle."),
  avatarEffect("lgbt", "canvas/misc/lgbt", "Adds a rainbow flag overlay."),
  avatarEffect("lolice", "canvas/misc/lolice", "Makes a joke 'police' meme."),
  avatarEffect("tonikawa", "canvas/misc/tonikawa", "Makes a Tonikawa anime frame."),
  avatarEffect("simp", "canvas/misc/simpcard", "Makes a joke 'simp card'.", ["simpcard"]),
  avatarEffect("comrade", "canvas/overlay/comrade", "Adds a comrade overlay."),
  avatarEffect("gay", "canvas/overlay/gay", "Adds a rainbow overlay."),
  avatarEffect("glass", "canvas/overlay/glass", "Adds a broken-glass overlay."),
  avatarEffect("jail", "canvas/overlay/jail", "Puts the picture behind bars."),
  avatarEffect("passed", "canvas/overlay/passed", "Adds a GTA 'mission passed' overlay."),
  avatarEffect("triggered", "canvas/overlay/triggered", "Makes a 'triggered' meme."),
  avatarEffect("wasted", "canvas/overlay/wasted", "Adds a GTA 'wasted' overlay.", ["waste"]),
  textEffect("stupid", "canvas/misc/its-so-stupid", "Makes an 'it's so stupid' dog meme.", {
    usage: "[text]",
    fields: ["dog"],
    defaults: { dog: "im stupid" },
    aliases: ["itssostupid", "iss", "its-so-stupid"],
  }),
  textEffect("namecard", "canvas/misc/namecard", "Makes a name card.", {
    usage: "username|birthday|description",
    fields: ["username", "birthday", "description?"],
  }),
  textEffect("oogway", "canvas/misc/oogway", "Master Oogway quote meme.", { usage: "<quote>", fields: ["quote"] }),
  textEffect("oogway2", "canvas/misc/oogway2", "Master Oogway quote meme (style 2).", { usage: "<quote>", fields: ["quote"] }),
  textEffect("tweet", "canvas/misc/tweet", "Makes a fake tweet image.", {
    usage: "displayname|username|comment|theme",
    fields: ["displayname", "username", "comment", "theme?"],
  }),
  textEffect("ytcomment", "canvas/misc/youtube-comment", "Makes a fake YouTube comment image.", {
    usage: "username|comment",
    fields: ["username", "comment"],
  }),
];
