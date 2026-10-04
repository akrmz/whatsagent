"use strict";

const { buildContext, parseCommand } = require("./context");
const { LEVELS } = require("./permissions");
const { LRU } = require("./lru");
const { UserError } = require("./errors");
const { MediaError } = require("./media");
const { HttpError } = require("../core/http");
const { maskJid } = require("../logger");

/**
 * The one place where every incoming message is processed:
 *   1. "pre" listeners (moderation, autoread, antidelete, PM blocker)  — everyone
 *   2. ban check
 *   3. command → mode, chat-type, permission, bot-admin and cooldown checks → run
 *      no command → "post" listeners (games, chatbot, mention reply, antitag)
 * Commands never re-implement these checks themselves.
 */

const DENIED = {
  owner: "❌ This command is only for the bot owner.",
  sudo: "❌ This command is only for the bot owner and sudo users.",
  groupAdmin: "❌ Only group admins can use this command.",
};

function createDispatcher(app) {
  const { config, log } = app;
  const cooldowns = new LRU({ max: 20000 });

  const atLeast = (level, wanted) => (LEVELS[level] ?? 0) >= LEVELS[wanted];
  const listenerApplies = (l, ctx) =>
    !(l.groupOnly && !ctx.isGroup) &&
    !(l.privateOnly && ctx.isGroup) &&
    !(l.publicOnly && !app.state.isPublic() && !atLeast(ctx.level, "sudo"));

  async function runListeners(key, ctx, ...extra) {
    for (const listener of app.listeners.byEvent.get(key) || []) {
      if (!listenerApplies(listener, ctx)) continue;
      try {
        const result = await listener.run(ctx, ...extra);
        if (result === "stop") return "stop";
      } catch (err) {
        log.error({ err, listener: listener.name }, "listener failed");
      }
    }
    return undefined;
  }

  function isBanned(ctx) {
    if (ctx.level === "owner") return false;
    const banned = new Set(app.state.store("banned", []).data);
    return app.identity.aliases(ctx.sender).some((a) => banned.has(a));
  }

  function checkCooldown(ctx, command) {
    const seconds = command.cooldown ?? config.limits.cooldownSeconds;
    if (!seconds || atLeast(ctx.level, "sudo")) return { ok: true };
    const key = `${ctx.sender}|${command.name}`;
    const entry = cooldowns.get(key);
    const now = Date.now();
    if (entry && entry.until > now) {
      const notify = !entry.notified;
      entry.notified = true;
      return { ok: false, notify, wait: Math.ceil((entry.until - now) / 1000) };
    }
    cooldowns.set(key, { until: now + seconds * 1000, notified: false }, seconds * 1000);
    return { ok: true };
  }

  async function execute(ctx) {
    const { command } = ctx;
    const p = config.bot.prefix;
    const needsGroup = command.groupOnly || command.permission === "groupAdmin" || command.botAdmin;
    if (needsGroup && !ctx.isGroup) return ctx.reply("This command can only be used in groups.");
    if (command.privateOnly && ctx.isGroup) return ctx.reply("This command only works in a private chat with the bot.");

    const allowed = await app.permissions.allows(command.permission, {
      level: ctx.level,
      isGroupChat: ctx.isGroup,
      groupAdmin: () => ctx.isSenderAdmin(),
    });
    if (!allowed) return ctx.reply(DENIED[command.permission] || DENIED.owner);

    if (command.botAdmin && !(await ctx.isBotAdmin())) return ctx.reply("Please make the bot a group admin first.");

    const cd = checkCooldown(ctx, command);
    if (!cd.ok) {
      if (cd.notify) await ctx.reply(`⏳ Please wait ${cd.wait}s before using ${p}${command.name} again.`);
      return undefined;
    }

    log.info({ command: command.name, chat: maskJid(ctx.chatId), sender: maskJid(ctx.sender) }, "command");
    try {
      await command.run(ctx);
    } catch (err) {
      if (err instanceof UserError || err instanceof MediaError) {
        await ctx.reply(`❌ ${err.message}`).catch(() => {});
      } else if (err instanceof HttpError) {
        log.warn({ command: command.name, err: err.message }, "external service failed");
        await ctx.reply("❌ The external service used by this command is not responding. Try again later.").catch(() => {});
      } else {
        log.error({ err, command: command.name }, "command failed");
        await ctx.reply(`❌ Something went wrong while running ${p}${command.name}.`).catch(() => {});
      }
    }
    await runListeners("command:after", ctx, command);
    return undefined;
  }

  async function handleMessage(sock, msg) {
    if (!msg?.message || !msg.key?.remoteJid) return;
    if (app.sentIds.has(msg.key.id)) return; // our own outgoing message echoed back
    app.health.lastMessageAt = Date.now();
    app.store.add(msg);
    app.identity.learnFromKey(msg.key);

    const jid = msg.key.remoteJid;
    if (jid === "status@broadcast") {
      await handleEvent("status", sock, msg);
      return;
    }
    if (jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;

    const ctx = buildContext(app, sock, msg);
    if ((await runListeners("message:pre", ctx)) === "stop") return;
    if (isBanned(ctx)) return;

    const parsed = parseCommand(ctx.body, config.bot.prefix);
    const command = parsed && app.commands.byName.get(parsed.name);
    if (!command) {
      await runListeners("message:post", ctx);
      return;
    }
    if (!app.state.isPublic() && !atLeast(ctx.level, "sudo")) return; // private mode
    Object.assign(ctx, { command, commandName: parsed.name, args: parsed.args, text: parsed.text });
    await execute(ctx);
  }

  async function handleUpsert(sock, { messages, type }) {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        log.error({ err }, "failed to handle message");
      }
    }
  }

  /** Runs listeners for raw events such as group-participants.update and call. */
  async function handleEvent(event, sock, payload) {
    for (const listener of app.listeners.byEvent.get(event) || []) {
      try {
        await listener.run({ app, sock, config, log, state: app.state }, payload);
      } catch (err) {
        log.error({ err, listener: listener.name }, "listener failed");
      }
    }
  }

  return { handleUpsert, handleMessage, handleEvent, execute };
}

module.exports = { createDispatcher };
