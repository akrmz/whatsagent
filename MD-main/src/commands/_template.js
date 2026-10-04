"use strict";

/**
 * TEMPLATE — copy this file to create a new command. Files starting with "_" are never loaded.
 *
 *   1. Copy it into a category folder, e.g.  src/commands/fun/coinflip.js
 *   2. Edit the fields below and write run(ctx).
 *   3. Restart the bot (or run `npm run check` to validate without connecting).
 * Nothing else needs to change: the command is discovered automatically and appears in .help.
 */

module.exports = {
  // Required. What users type after the prefix. Lowercase letters, digits, dashes.
  name: "example",

  // Optional. Other names that run the same command. Must be unique across all commands.
  aliases: ["ex"],

  // Required. Groups the command in .help (general, admin, owner, sticker, image,
  // textmaker, download, ai, fun, misc, anime, games — or a new one).
  category: "general",

  // Required. One sentence shown in .help <command>.
  description: "Shows how a command is written.",

  // Optional. Arguments shown after the name in .help, e.g. "<city>" or "[on|off]".
  usage: "<text>",

  // Optional. Shown in .help <command>. Use "." — it is replaced by the configured prefix.
  examples: [".example hello"],

  // Who may run it: "user" (everyone), "groupAdmin", "sudo" or "owner". Default "user".
  // The dispatcher enforces this before run() is called — never re-check it yourself.
  permission: "user",

  // Optional chat restrictions (enforced centrally). groupAdmin implies groupOnly.
  groupOnly: false,
  privateOnly: false,

  // Optional. The bot itself must be a group admin (e.g. to kick or delete messages).
  botAdmin: false,

  // Optional. Seconds a user must wait between uses (owner and sudo are exempt).
  // Omit to use DEFAULT_COOLDOWN_SECONDS from .env.
  cooldown: 5,

  // Optional. Capabilities this command needs; if any is missing the command is
  // disabled at startup and hidden from .help. See detectCapabilities() in src/main.js
  // (ffmpeg, ytdlp, ai, font, newsApi, openWeather, tenor, telegramBot, removeBg, remini, githubRepo).
  requires: [],

  // Optional. Shown in .help <command> when the command sends data to a third party.
  externalService: undefined,

  // Optional. Hide from the menu (still runnable).
  hidden: true,

  /**
   * Runs the command. Useful ctx fields (full list in docs/ADDING_FEATURES.md):
   *   ctx.args / ctx.text      arguments as an array / as the raw string (original casing)
   *   ctx.reply(textOrContent) reply quoting the user's message
   *   ctx.react("✅")          react to the user's message
   *   ctx.target()             first @mention or the author of the replied message
   *   ctx.findMedia() / ctx.download(media)   media in the message or the replied one
   *   ctx.isGroup, ctx.chatId, ctx.sender, ctx.level, ctx.config, ctx.state, ctx.log
   * Throw new UserError("message") (src/core/errors.js) to show a friendly error.
   * Any other error is logged and the user sees a generic failure message.
   */
  async run(ctx) {
    if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}example <text>`);
    return ctx.reply(`You said: ${ctx.text}`);
  },
};
