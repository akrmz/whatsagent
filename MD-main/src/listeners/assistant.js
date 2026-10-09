"use strict";

const re = require("../services/realestate");
const assistant = require("../services/assistant");
const leads = require("../services/leads");

module.exports = [
  {
    /**
     * The agent writes to a client from the phone (not a command, not something the bot sent):
     * the assistant steps back in that chat (12 hours, .assistant takeover), and the agent gets one note.
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
      const key = assistant.keyOf(ctx.app, ctx.chatId);
      const wasQuiet = assistant.pausedUntil(ctx.state, key);
      const asked = assistant.humanAsked(ctx.state, key);
      assistant.pause(ctx.state, key);
      // One note to the agent when they take over a saved client (not for every message, not for family chats).
      const lead = /^\d{8,15}$/.test(key) ? leads.byPhone(ctx.state, key) : null;
      const owner = `${ctx.config.owners.numbers[0]}@s.whatsapp.net`;
      if (lead && !assistant.isIgnored(ctx.state, key) && (!wasQuiet || asked) && owner !== ctx.chatId) {
        const hours = Math.round(assistant.takeoverMs(ctx.state) / 3600000);
        await ctx.sock
          .sendMessage(owner, { text: `⏸️ رديت على ${lead.name || "العميل"} (+${key})${asked ? " اللي كان طالب يكلمك" : ""} — المساعد ساكت معاه ${hours} ساعة.\nترجّعه دلوقتي: ${ctx.prefix}assistant resume ${key}` })
          .catch(() => {});
      }
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
