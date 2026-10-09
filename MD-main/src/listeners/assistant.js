"use strict";

const re = require("../services/realestate");
const assistant = require("../services/assistant");

module.exports = [
  {
    /**
     * The agent writes to a client from the phone (not a command, not something the bot sent):
     * the assistant steps back in that chat for 12 hours.
     */
    name: "assistant-takeover",
    event: "message",
    phase: "post",
    priority: 3,
    privateOnly: true,
    async run(ctx) {
      // Any message: a text, a voice note, a photo… (only a command is not a reply to the client).
      if (!ctx.fromMe || ctx.chatId === ctx.botJid || (ctx.body || "").trim().startsWith(ctx.prefix)) return undefined;
      if (!re.agent(ctx.state).assistant) return undefined;
      assistant.pause(ctx.state, assistant.keyOf(ctx.app, ctx.chatId));
      return undefined;
    },
  },
  {
    /**
     * With ".assistant on": the AI answers clients' questions in private chats, from the
     * catalogue. After the listing codes, the client menu, self-booking and written requests,
     * so those keep their exact answers; before the greeting and away messages.
     */
    name: "assistant",
    event: "message",
    phase: "post",
    priority: 26,
    publicOnly: true,
    privateOnly: true,
    async run(ctx) {
      // Text, or a voice note (written out first, when a Gemini or OpenAI key is set).
      if (ctx.fromMe || ctx.isSudoOrOwner || !ctx.app.ai || !re.agent(ctx.state).assistant) return undefined;
      return (await assistant.handle(ctx)) ? "stop" : undefined;
    },
  },
];
