"use strict";

const crypto = require("node:crypto");
const { buildContext, getContextInfo, parseCommand } = require("../core/context");
const { UserError } = require("../core/errors");

/**
 * ".in <group> <command>": the owner runs a command from their private chat as if they had sent
 * it in a group (to turn on daily azkar, the listing of the day, a schedule … without writing in
 * the group). The command goes through the same checks as a typed one (the dispatcher's
 * execute). Its replies (the confirmations, which quote the command) come back to the owner's
 * chat, labelled with the group's name; what it posts in the chat (the first hadith, a listing)
 * goes to the group. With `post`, its replies go to the group too. Scheduled posts it sets up go
 * to the group as usual, since they are stored for that chat.
 */

const NOT_HERE = new Set(["in"]); // no ".in 3 in 4 …"

/**
 * @returns {Promise<{ subject: string, answers: number, posted: number }>} the group name, answers that came back, messages posted there
 */
async function runIn(ctx, groupId, commandText, { post = false } = {}) {
  const { app } = ctx;
  const p = app.config.bot.prefix;
  const body = String(commandText || "").trim();
  const parsed = parseCommand(body.startsWith(p) ? body : `${p}${body}`, p); // "autoazkar on" or ".autoazkar on"
  const command = parsed && app.commands.byName.get(parsed.name);
  if (!command) throw new UserError(`There is no command "${parsed?.name || commandText}". ${p}menu lists them.`);
  if (NOT_HERE.has(command.name)) throw new UserError(`${p}in can't run ${p}${command.name}.`);
  const meta = await app.groups.get(ctx.sock, groupId).catch(() => null);
  if (!meta) throw new UserError(`The bot isn't in that group, or it doesn't exist. ${p}groups lists the groups it is in.`);

  // The message as if typed in the group by the owner, keeping what it replies to (a photo …).
  const contextInfo = getContextInfo(ctx.content);
  const msg = {
    key: { id: `IN${crypto.randomBytes(8).toString("hex").toUpperCase()}`, remoteJid: groupId, participant: ctx.fromMe ? undefined : ctx.sender, fromMe: ctx.fromMe },
    pushName: ctx.senderName,
    message: { extendedTextMessage: { text: `${p}${parsed.name}${parsed.text ? ` ${parsed.text}` : ""}`, ...(contextInfo ? { contextInfo } : {}) } },
  };

  // A reply to the command (quoting it) comes back here; what a command posts in the chat without
  // quoting (the first hadith of .autohadith, a listing of the day) goes to the group, where it
  // would have gone if typed there. With post, the replies go to the group too. The message above
  // was never sent, so nothing quotes it or reacts to it.
  const label = `📍 *${meta.subject || groupId}*`;
  let answers = 0;
  let posted = 0;
  const sock = Object.create(ctx.sock);
  sock.sendMessage = (jid, content, options = {}) => {
    const own = options.quoted?.key?.id === msg.key.id;
    const opts = own ? { ...options, quoted: undefined } : options;
    if (jid !== groupId) return ctx.sock.sendMessage(jid, content, opts);
    if (content?.react) return Promise.resolve(undefined);
    if (post || !own) {
      posted++;
      return ctx.sock.sendMessage(groupId, content, opts);
    }
    answers++;
    const labelled =
      typeof content?.text === "string"
        ? { ...content, text: `${label}\n${content.text}` }
        : content?.image || content?.video || content?.document
          ? { ...content, caption: `${label}${content.caption ? `\n${content.caption}` : ""}` }
          : content;
    return ctx.sock.sendMessage(ctx.chatId, labelled, opts);
  };

  const remote = buildContext(app, sock, msg);
  Object.assign(remote, { command, commandName: parsed.name, args: parsed.args, text: parsed.text, remoteFrom: ctx.chatId });
  ctx.log.info({ command: command.name, post }, "command run in a group from the owner's chat");
  await app.dispatch.execute(remote);
  return { subject: meta.subject || groupId, answers, posted };
}

module.exports = { runIn };
