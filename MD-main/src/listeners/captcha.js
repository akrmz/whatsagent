"use strict";

const captcha = require("../services/captcha");
const { deleteMessage } = require("../services/moderation");
const { at } = require("../services/targets");

const jidOf = (p) => (typeof p === "string" ? p : p?.id || p?.phoneNumber || "");

module.exports = [
  {
    name: "captcha-join",
    event: "group-participants.update",
    async run({ app, sock, log }, { id, participants, action, author }) {
      if (action !== "add") {
        if (action === "remove") for (const p of participants) captcha.cancel(id, jidOf(p));
        return;
      }
      const s = captcha.get(app.state, id);
      if (!s?.enabled) return;
      const meta = await app.groups.get(sock, id).catch(() => null);
      const admins = new Set((meta?.participants || []).filter((p) => p.admin).flatMap((p) => app.identity.aliases(p.id)));
      // Added by an admin: trusted. Joined by link (no author, or the member themself): checked.
      const byAdmin = author && app.identity.aliases(jidOf(author)).some((a) => admins.has(a));
      if (byAdmin) return;
      const botIsAdmin = [sock.user?.id, sock.user?.lid].filter(Boolean).some((b) => app.identity.aliases(b).some((a) => admins.has(a)));
      if (!botIsAdmin) return log.warn("captcha is on but the bot is not a group admin; skipped");
      for (const p of participants) {
        const user = jidOf(p);
        if (user) await captcha.challenge({ sock, log }, id, user, s.minutes || 3).catch((err) => log.warn({ err: err.message }, "captcha failed"));
      }
    },
  },
  {
    name: "captcha-answer",
    event: "message",
    phase: "pre",
    priority: 8, // before everything else: an unverified member can't use the bot or chat
    groupOnly: true,
    async run(ctx) {
      if (ctx.fromMe || !captcha.isPending(ctx.chatId, ctx.sender)) return undefined;
      const result = captcha.answer(ctx.chatId, ctx.sender, ctx.body);
      if (result === "passed") {
        await ctx.reply({ text: `✅ ${at(ctx.sender)} تم التحقق، أهلاً بك! (verified)`, mentions: [ctx.sender] }).catch(() => {});
        return "stop";
      }
      await deleteMessage(ctx).catch(() => {});
      if (result === "failed") await captcha.expel(ctx.sock, ctx.log, ctx.chatId, ctx.sender, `أخطأ في سؤال التحقق ${captcha.MAX_ATTEMPTS} مرات فتمت إزالته.`);
      return "stop";
    },
  },
];
