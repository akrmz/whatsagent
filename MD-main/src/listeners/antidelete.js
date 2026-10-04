"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { files } = require("../services/settings");
const { LRU } = require("../core/lru");
const { findMedia, downloadMedia } = require("../core/media");
const { at } = require("../services/targets");

/**
 * Antidelete: while enabled, keeps recent messages (text in memory, media on disk, both
 * limited in count, size and age — see ANTIDELETE_* in .env). When someone deletes a
 * message, a copy is sent to the bot's own chat. View-once media is forwarded right away.
 */

let messages = null; // id → { text, sender, chat, mediaFile, type }
let mediaFiles = null; // id → file path (evicting deletes the file)

function stores(ctx) {
  if (!messages) {
    const dir = path.join(ctx.config.paths.tmp, "antidelete");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    mediaFiles = new LRU({ max: 200, ttlMs: 24 * 3600e3, onEvict: (_id, file) => fs.rm(file, { force: true }, () => {}) });
    messages = new LRU({ max: ctx.config.limits.antideleteMessages, ttlMs: 24 * 3600e3, onEvict: (id) => mediaFiles.delete(id) });
    messages.dir = dir;
  }
  return { messages, mediaFiles };
}

function ownChat(ctx) {
  return `${String(ctx.sock.user.id).split(":")[0].split("@")[0]}@s.whatsapp.net`;
}

async function sendMedia(sock, to, type, buffer, caption, mentions) {
  const content =
    type === "image"
      ? { image: buffer, caption }
      : type === "video"
        ? { video: buffer, caption }
        : type === "sticker"
          ? { sticker: buffer }
          : { audio: buffer, mimetype: "audio/mpeg" };
  return sock.sendMessage(to, { ...content, mentions });
}

async function handleRevoke(ctx, revokedId) {
  const { messages: msgs, mediaFiles: media } = stores(ctx);
  const original = msgs.get(revokedId);
  if (!original) return;
  msgs.delete(revokedId);
  const to = ownChat(ctx);
  let group = "";
  if (original.chat.endsWith("@g.us")) group = (await ctx.app.groups.get(ctx.sock, original.chat).catch(() => null))?.subject || "";
  const lines = [
    "*🔰 ANTIDELETE REPORT 🔰*",
    "",
    `*Deleted by:* ${at(ctx.sender)}`,
    `*Sender:* ${at(original.sender)}`,
    group ? `*Group:* ${group}` : null,
    `*Time:* ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
    original.text ? `\n*Message:*\n${original.text}` : null,
  ].filter((l) => l !== null);
  await ctx.sock.sendMessage(to, { text: lines.join("\n"), mentions: [ctx.sender, original.sender] });
  const file = media.get(revokedId);
  if (file && fs.existsSync(file)) {
    await sendMedia(ctx.sock, to, original.type, fs.readFileSync(file), `Deleted ${original.type} from ${at(original.sender)}`, [original.sender]);
    media.delete(revokedId);
  }
}

module.exports = {
  name: "antidelete",
  event: "message",
  phase: "pre",
  priority: 5,
  async run(ctx) {
    if (!files.antidelete(ctx.state).data.enabled || ctx.fromMe) return undefined;
    const proto = ctx.content?.protocolMessage;
    if (proto) {
      if (proto.type === 0 && proto.key?.id) await handleRevoke(ctx, proto.key.id);
      return "stop";
    }
    const { messages: msgs, mediaFiles: media } = stores(ctx);
    const entry = { text: ctx.body.slice(0, 4000), sender: ctx.sender, chat: ctx.chatId, type: null };
    const found = findMedia(ctx.msg, { types: ["image", "video", "audio", "sticker"], quoted: false });
    const limit = ctx.config.limits.antideleteMediaBytes;
    if (found && limit > 0 && (!found.size || found.size <= limit)) {
      try {
        const buffer = await downloadMedia(found, limit);
        if (found.viewOnce) {
          await sendMedia(ctx.sock, ownChat(ctx), found.type, buffer, `*Anti-ViewOnce ${found.type}*\nFrom: ${at(ctx.sender)}`, [ctx.sender]);
        } else {
          const file = path.join(msgs.dir, ctx.msg.key.id.replace(/[^\w-]/g, ""));
          fs.writeFileSync(file, buffer, { mode: 0o600 });
          media.set(ctx.msg.key.id, file);
          entry.type = found.type;
        }
      } catch (err) {
        ctx.log.debug({ err: err.message }, "antidelete: media not stored");
      }
    }
    msgs.set(ctx.msg.key.id, entry);
    return undefined;
  },
};
