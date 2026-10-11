"use strict";

const re = require("./realestate");
const leads = require("./leads");
const viewings = require("./viewings");
const rotation = require("./rotation");

/**
 * The client's own word on a viewing (.agent feedback on): 3 hours after it, if no outcome is
 * recorded, the client is asked once what they thought. A clear answer ("عجبتني", "هفكر",
 * "مش مناسبة", 👍 🤔 👎) becomes the viewing's outcome, with their words as the note, as if the
 * agent had written ".viewing done"; anything else goes to the agent as it is. The question is
 * open for a day, and only one answer is taken.
 */

const ASK_AFTER = 3 * 3600 * 1000;
const OPEN_FOR = 24 * 3600 * 1000;

// Negative first: "مش حلوة" is a no, though it has "حلوة" in it.
const NO = /(?:مش|مو|ما|مـش)\s*(?:مناسب|مناسبة|مناسبه|حلو|حلوة|حلوه|عاجب|عاجباني|كويس|كويسة)|معجبتنيش|ماعجبتنيش|ماعجبنيش|معجبنيش|مش عجباني|مش عاجباني|غالية|غالي|صغيرة|بعيدة|لا شكرا|لأ شكرا|^\s*(?:لا|لأ|no)\s*$|👎|not for me|didn'?t like/iu;
const THINKING = /هفكر|بفكر|محتاج أفكر|محتاج افكر|هشوف|لسه|هرد|مش متأكد|مش متاكد|هستشير|🤔|thinking|maybe|not sure/iu;
const LIKED = /عجبتني|عجبني|عجباني|حلوة|حلوه|حلو|ممتاز|ممتازة|جميلة|جميل|رائعة|تحفة|كويسة|مناسبة|👍|❤️|😍|liked|loved|great|perfect/iu;

/** What a reply says about the viewing: "liked", "thinking", "no", or null. */
function classify(text) {
  const t = re.squeeze(String(text || "")).trim();
  if (!t || t.length > 200) return null;
  if (NO.test(t)) return "no";
  if (THINKING.test(t)) return "thinking";
  if (LIKED.test(t)) return "liked";
  return null;
}

/** The question the client gets. */
function question(state, v) {
  const l = re.get(state, v.listing);
  const c = leads.get(state, v.lead);
  const what = `${l?.type || "الوحدة"}${l?.location ? ` في ${l.location.slice(0, 40)}` : ""}`;
  return `${c?.name ? `أهلاً ${c.name} 👋` : "أهلاً 👋"}\nإيه رأيك في ${what} اللي عاينتها؟\nرد بكلمة: *عجبتني* · *هفكر* · *مش مناسبة*، أو اكتبلي رأيك 🙏`;
}

/** Viewings whose client should be asked now. */
function due(state, now = Date.now()) {
  if (!re.agent(state).feedback) return [];
  return viewings.upcoming(state, now - OPEN_FOR).filter((v) => !v.outcome && !v.clientAsked && v.at <= now - ASK_AFTER && now - v.at < OPEN_FOR);
}

/** Sends the questions that are due. @returns {Promise<number>} */
async function askDue(app, now = Date.now()) {
  if (!app.sock || app.health.state !== "open") return 0;
  let sent = 0;
  for (const v of due(app.state, now)) {
    viewings.mark(app.state, v.id, { clientAsked: now });
    const c = leads.get(app.state, v.lead);
    if (!c?.phone || c.optedOut || ["won", "lost"].includes(c.status)) continue;
    try {
      await app.sock.sendMessage(`${c.phone}@s.whatsapp.net`, { text: question(app.state, v) });
      sent++;
    } catch (err) {
      app.log.warn({ err: err.message }, "viewing feedback question not sent");
    }
  }
  return sent;
}

const REPLY = {
  liked: "تمام 🙏 مبسوط إنها عجبتك. هكلمك قريب نكمّل الخطوات.",
  thinking: "تمام، خد وقتك 🙏 لو عندك أي سؤال أنا موجود.",
  no: "شكراً لصراحتك 🙏 قولي إيه اللي ما عجبكش وأبعتلك اختيارات أنسب.",
};

/** A client's reply in a private chat. @returns {Promise<"stop"|"pass"|null>} null: not about a viewing */
async function handle(ctx, now = Date.now()) {
  const pn = ctx.app.identity.toPn(ctx.sender);
  const phone = pn ? pn.split("@")[0] : null;
  const lead = phone && leads.byPhone(ctx.state, phone);
  if (!lead) return null;
  const v = viewings
    .upcoming(ctx.state, now - OPEN_FOR)
    .filter((x) => x.lead === lead.id && x.clientAsked && !x.clientAnswered && !x.outcome && now - x.clientAsked < OPEN_FOR)
    .at(-1);
  if (!v) return null;
  viewings.mark(ctx.state, v.id, { clientAnswered: now });
  const text = String(ctx.body || "").trim().slice(0, 200);
  const result = classify(text);
  const to = rotation.notifyJid(ctx.app, lead);
  const who = `${lead.name || "العميل"} (+${phone})`;
  if (!result) {
    // Not a clear answer: the agent reads it; other listeners (the assistant) may answer it too.
    leads.note(ctx.state, lead.id, ctx.sender, `رد على سؤال المعاينة #${v.listing}: ${text}`, now);
    await ctx.sock.sendMessage(to, { text: `💬 ${who} رد عن معاينة #${v.listing}:\n"${text}"\n${ctx.prefix}viewing done ${v.id} liked | thinking | no` }).catch(() => {});
    return "pass";
  }
  viewings.done(ctx.state, v.id, result, text, "client", now);
  await ctx.reply(REPLY[result]);
  const next = result === "liked" ? `\n🤝 اتنقل للتفاوض. الخطوة الجاية: ${ctx.prefix}offer ${v.listing} #${lead.id} …` : result === "no" ? `\n🔎 اختيارات تانية له: ${ctx.prefix}lead ${lead.id}` : `\n⏰ ${ctx.prefix}lead follow ${lead.id} بعد 3 أيام`;
  await ctx.sock.sendMessage(to, { text: `🗣️ ${who} عن معاينة #${v.listing}: ${viewings.RESULTS[result].ar} — "${text}"${next}` }).catch(() => {});
  return "stop";
}

module.exports = { classify, question, due, askDue, handle, ASK_AFTER, OPEN_FOR };
