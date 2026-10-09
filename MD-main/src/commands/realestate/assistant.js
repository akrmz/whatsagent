"use strict";

const re = require("../../services/realestate");
const leads = require("../../services/leads");
const assistant = require("../../services/assistant");
const requests = require("../../services/requests");
const { UserError } = require("../../core/errors");

const idOf = (s) => {
  const n = Number(re.latinDigits(String(s || "")).replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A client by number (#5) or phone; the key the assistant uses for their chat. */
function clientKey(ctx, arg) {
  const id = idOf(arg);
  const lead = id && id < 1e6 ? leads.get(ctx.state, id) : null;
  if (lead?.phone) return { key: lead.phone, label: `#${lead.id}` };
  if (id && id < 1e6) throw new UserError(lead ? `Client #${id} has no number.` : `There is no client #${id}.`);
  const phone = re.latinDigits(String(arg || "")).replace(/\D/g, "");
  if (phone.length >= 8) return { key: phone, label: `+${phone}` };
  throw new UserError(`Which client? ${ctx.prefix}assistant pause 5 (a client number) or a phone number.`);
}

const HELP = (p) =>
  [
    "🤖 *Customer assistant · المساعد*",
    `${p}assistant on | off — answer clients' questions in private chats with the AI, from your catalogue`,
    `${p}assistant info <text> — office facts it may use (address, hours, how you work) · ${p}assistant info clear`,
    `${p}assistant test <question> — see what a client would get`,
    `${p}assistant pause 5 [hours] · ${p}assistant resume 5 — stop or restart it for one client`,
    `${p}assistant inbox — clients waiting for your reply (reminded once after 2 hours) · ${p}assistant done 5`,
    "",
    "When you answer a client yourself from your phone, it steps back in that chat for 12 hours.",
  ].join("\n");

module.exports = {
  name: "assistant",
  aliases: ["mosaed", "customerbot", "salesbot"],
  category: "realestate",
  description:
    "المساعد الذكي للعملاء — a chatbot for your clients: in private chats the AI answers their questions (prices, areas, sizes, payment plans, what is available) from your catalogue, projects and office information only, never inventing prices or features. When it can't answer, or the client wants to negotiate, call or reserve, it says you'll follow up and tells you. It sends the cards of listings it recommends, saves what the client wants on their card, and also answers voice notes (written out first, with a Gemini or OpenAI key). It steps back for 12 hours in a chat where you reply yourself. Needs an AI key (.setai). Owner and sudo users.",
  usage: "on | off | info <text>|clear | test <question> | inbox | done <client> | pause <client> [hours] | resume <client>",
  examples: [".assistant on", ".assistant info المكتب في التجمع الخامس، من السبت للخميس 11ص–7م. العمولة 2.5% على المشتري.", ".assistant test فيه شقق في التجمع تحت 3 مليون؟", ".assistant pause 5", ".assistant"],
  permission: "sudo",
  cooldown: 3,
  externalService: "the configured AI provider (clients' messages, with phone numbers masked, and your public catalogue are sent); Gemini or OpenAI for voice notes (the audio is sent)",
  async run(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();
    const rest = ctx.text.replace(/^\s*\S+\s*/, "");
    const p = ctx.prefix;

    if (sub === "on" || sub === "off") {
      if (sub === "on" && !ctx.app.ai) throw new UserError(`No AI is set up yet. The owner adds a key with ${p}setai, then ${p}assistant on.`);
      re.setAgent(ctx.state, "assistant", sub);
      return ctx.reply(
        sub === "on"
          ? `✅ The assistant answers clients in private chats now.\n• Add your office facts: ${p}assistant info …\n• Try it: ${p}assistant test <a client's question>\n• Reply to a client yourself and it steps back in that chat for 12 hours.`
          : "⏹️ The assistant is off. Clients get the greeting and away messages as before.",
      );
    }
    if (sub === "info") {
      if (!rest) return ctx.reply(assistant.info(ctx.state) ? `📋 *Office info for the assistant*\n\n${assistant.info(ctx.state)}\n\nChange: ${p}assistant info <text> · ${p}assistant info clear` : `No office info yet. ${p}assistant info المكتب في … المواعيد … (up to ${assistant.MAX_INFO} characters)`);
      const v = assistant.setInfo(ctx.state, /^(clear|del|off|حذف|مسح)$/i.test(rest) ? "" : rest);
      return ctx.reply(v ? `✅ Saved (${v.length} characters). The assistant may tell clients this.` : "🗑️ Office info cleared.");
    }
    if (sub === "test") {
      if (!ctx.app.ai) throw new UserError(`No AI is set up yet (${p}setai).`);
      if (!rest) throw new UserError(`Write a client's question: ${p}assistant test عندك شقة في التجمع؟`);
      await ctx.react("🤖");
      const { text, handoff, show, wants } = await assistant.answer(ctx.app, { state: ctx.state, key: `test|${ctx.sender}`, lead: null, text: rest });
      const extra = [
        show.length && `📎 plus the card${show.length > 1 ? "s" : ""} of ${show.map((l) => `#${l.id}`).join(", ")} (with the photo)`,
        Object.keys(wants).length && `📝 saved on the client's card: ${requests.describe({ ...wants, type: wants.type || "عقار" }, re.agent(ctx.state).currency)}`,
        handoff && "🙋 and you'd be told to follow up",
      ].filter(Boolean);
      return ctx.reply(`🧪 *A client would get:*\n\n${text}${extra.length ? `\n\n${extra.join("\n")}` : ""}`);
    }
    if (sub === "inbox" || sub === "waiting" || sub === "done") {
      // Names and numbers: only where no outsider reads them (see B-21).
      if (!(await ctx.isStaffOnlyChat())) return ctx.reply(`🔒 The list names clients: use ${p}assistant ${sub} in your private chat with the bot, or in a group of staff only.`);
      if (sub === "done") {
        const { key, label } = clientKey(ctx, ctx.args[1]);
        return ctx.reply(assistant.clearWaiting(ctx.state, key) ? `✅ ${label} is off the waiting list.` : `${label} wasn't waiting.`);
      }
      const now = Date.now();
      const list = assistant.waiting(ctx.state, now);
      if (!list.length) return ctx.reply("✅ Nobody is waiting for you: every client the assistant handed over has had your reply.");
      return ctx.reply(
        [`🙋 *Waiting for your reply* (${list.length}) — oldest first`, "", ...list.slice(0, 20).map((w) => assistant.waitingLine(w, now, p)), "", `A client leaves the list when you reply to them from your phone. Done another way: ${p}assistant done <client>`].join("\n"),
      );
    }
    if (sub === "pause" || sub === "resume") {
      const { key, label } = clientKey(ctx, ctx.args[1]);
      if (sub === "resume") {
        assistant.resume(ctx.state, key);
        return ctx.reply(`▶️ The assistant answers ${label} again.`);
      }
      const hours = Number(re.latinDigits(ctx.args[2] || "")) || 12;
      if (!(hours > 0 && hours <= 24 * 30)) throw new UserError("Hours: 1 to 720.");
      assistant.pause(ctx.state, key, hours * 3600 * 1000);
      return ctx.reply(`⏸️ The assistant is quiet with ${label} for ${hours} hour(s). ${p}assistant resume ${ctx.args[1]}`);
    }
    if (sub) return ctx.reply(HELP(p));

    const a = re.agent(ctx.state);
    const tz = ctx.config.bot.timezone;
    return ctx.reply(
      [
        `🤖 *Customer assistant*: ${a.assistant ? "on" : "off"}${ctx.app.ai ? ` (${ctx.app.ai.label})` : " — no AI set up (.setai)"}`,
        `Answers today: ${assistant.answeredToday(ctx.state, tz)} of ${assistant.PER_DAY} (at most ${assistant.PER_CLIENT_DAY} per client)`,
        `Chats where it's quiet (you're talking): ${assistant.pausedCount(ctx.state)}`,
        `Waiting for your reply: ${assistant.waiting(ctx.state).length}${assistant.waiting(ctx.state).length ? ` — ${p}assistant inbox` : ""}`,
        `Office info: ${assistant.info(ctx.state) ? `${assistant.info(ctx.state).length} characters` : "none"}`,
        "",
        HELP(p),
      ].join("\n"),
    );
  },
};
