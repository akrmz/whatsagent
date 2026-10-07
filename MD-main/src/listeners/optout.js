"use strict";

const leads = require("../services/leads");

/**
 * A saved client who sends "وقف" (or "stop") in a private chat gets no more campaign messages
 * or sent listings; "اشتراك" (or "start") turns them back on. Only saved clients are answered,
 * and only when their choice changes. Works in private mode too: a stop request is always honoured.
 */
const STOP = /^(وقف|توقف|ايقاف|إيقاف|الغاء|إلغاء|stop|unsubscribe)$/i;
const START = /^(اشتراك|اشترك|start|subscribe)$/i;

module.exports = {
  name: "offers-opt-out",
  event: "message",
  phase: "post",
  priority: 12,
  privateOnly: true,
  async run(ctx) {
    if (ctx.fromMe) return undefined;
    const word = ctx.body.trim().replace(/[.!؟?]+$/, "");
    const stop = STOP.test(word);
    if (!stop && !START.test(word)) return undefined;
    const pn = ctx.app.identity.toPn(ctx.sender);
    const phone = pn ? pn.split("@")[0] : null;
    const lead = phone ? leads.all(ctx.state).find((l) => l.phone === phone) : null;
    if (!lead) return undefined;
    if (Boolean(lead.optedOut) === stop) return "stop"; // nothing changes: no reply
    leads.setOptOut(ctx.state, lead.id, stop);
    await ctx.reply(stop ? "✅ تم إيقاف رسائل العروض. لو حبيت تستقبلها تاني أرسل: اشتراك" : "✅ تم تفعيل رسائل العروض مرة أخرى. لإيقافها أرسل: وقف");
    return "stop";
  },
};
