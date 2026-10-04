"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { files, groupData } = require("../services/settings");
const { handleTicTacToeMove } = require("../services/games");
const { LRU } = require("../core/lru");
const { isBot } = require("../services/targets");

const ASSETS_ROOT = path.join(__dirname, "..", "..");
const pmNotified = new LRU({ max: 5000, ttlMs: 60 * 60 * 1000 });

const mentionsBot = (ctx) => ctx.mentions.some((j) => isBot(ctx, j));

module.exports = [
  {
    name: "autoread",
    event: "message",
    phase: "pre",
    priority: 10,
    async run(ctx) {
      if (ctx.fromMe || !files.autoread(ctx.state).data.enabled || mentionsBot(ctx)) return;
      await ctx.sock.readMessages([ctx.msg.key]).catch(() => {});
    },
  },
  {
    name: "message-counter",
    event: "message",
    phase: "pre",
    priority: 30,
    groupOnly: true,
    async run(ctx) {
      if (ctx.fromMe) return;
      files.messageCounts(ctx.state).update((d) => {
        d[ctx.chatId] ||= {};
        d[ctx.chatId][ctx.sender] = (d[ctx.chatId][ctx.sender] || 0) + 1;
      });
    },
  },
  {
    name: "pmblocker",
    event: "message",
    phase: "pre",
    priority: 50,
    privateOnly: true,
    async run(ctx) {
      const s = files.pmblocker(ctx.state).data;
      if (!s.enabled || ctx.fromMe || ctx.level === "owner" || ctx.level === "sudo") return undefined;
      if (!pmNotified.get(ctx.chatId)) {
        pmNotified.set(ctx.chatId, true);
        await ctx.send(s.message).catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
      }
      await ctx.sock.updateBlockStatus(ctx.chatId, "block").catch(() => {});
      return "stop";
    },
  },
  {
    name: "games",
    event: "message",
    phase: "post",
    priority: 10,
    async run(ctx) {
      const text = ctx.body.trim();
      if (!/^([1-9]|surrender|give up)$/i.test(text)) return undefined;
      return (await handleTicTacToeMove(ctx, text)) ? "stop" : undefined;
    },
  },
  {
    name: "mention-reply",
    event: "message",
    phase: "post",
    priority: 30,
    groupOnly: true,
    async run(ctx) {
      if (ctx.fromMe || !mentionsBot(ctx)) return undefined;
      const s = files.mention(ctx.state).data;
      if (!s.enabled) return undefined;
      const file = s.assetPath ? path.resolve(ASSETS_ROOT, s.assetPath) : "";
      const inAssets = file.startsWith(path.join(ASSETS_ROOT, "assets") + path.sep);
      if (s.type === "text" || !s.assetPath || !inAssets || !fs.existsSync(file)) {
        await ctx.reply(s.text || "Hi");
        return "stop";
      }
      const buffer = fs.readFileSync(file);
      const payload =
        s.type === "sticker"
          ? { sticker: buffer }
          : s.type === "image"
            ? { image: buffer }
            : s.type === "video"
              ? { video: buffer, gifPlayback: Boolean(s.gifPlayback) }
              : { audio: buffer, mimetype: s.mimetype || "audio/mpeg", ptt: Boolean(s.ptt) };
      await ctx.reply(payload);
      return "stop";
    },
  },
  {
    name: "chatbot",
    event: "message",
    phase: "post",
    priority: 40,
    groupOnly: true,
    publicOnly: true,
    requires: ["ai"],
    async run(ctx) {
      if (ctx.fromMe || !ctx.body || !groupData(ctx.state).data.chatbot[ctx.chatId]) return undefined;
      const repliedToBot = ctx.quoted?.sender && isBot(ctx, ctx.quoted.sender);
      if (!mentionsBot(ctx) && !repliedToBot) return undefined;
      const text = ctx.body.replace(/@\d+/g, "").trim();
      if (!text) return undefined;
      await ctx.sock.sendPresenceUpdate("composing", ctx.chatId).catch(() => {});
      try {
        const answer = await ctx.app.ai.ask(text);
        await ctx.reply(answer);
      } catch (err) {
        ctx.log.warn({ err: err.message }, "chatbot reply failed");
      }
      return "stop";
    },
  },
  {
    name: "autotyping",
    event: "message",
    phase: "post",
    priority: 90,
    async run(ctx) {
      if (ctx.fromMe || !files.autotyping(ctx.state).data.enabled) return;
      const { sock, chatId } = ctx;
      sock.sendPresenceUpdate("composing", chatId).catch(() => {});
      setTimeout(() => sock.sendPresenceUpdate("paused", chatId).catch(() => {}), 3000).unref();
    },
  },
  {
    name: "after-command",
    event: "command:after",
    priority: 10,
    async run(ctx) {
      if (groupData(ctx.state).data.autoReaction) await ctx.react("⏳");
      if (files.autotyping(ctx.state).data.enabled) {
        ctx.sock.sendPresenceUpdate("paused", ctx.chatId).catch(() => {});
      }
    },
  },
];
