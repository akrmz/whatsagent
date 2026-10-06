"use strict";

const { canManage, DENIED, zoneLine } = require("../../services/islamic-access");
const azkar = require("../../services/azkar");
const autopost = require("../../services/autopost");
const { zoneNow } = require("../../services/gcschedule");
const { parseClock } = require("../../services/reminders");
const { UserError } = require("../../core/errors");


const KIND_AR = { morning: "أذكار الصباح", evening: "أذكار المساء", dua: "الدعاء اليومي", sleep: "أذكار النوم" };

async function autoStatus(ctx, entry) {
  const post = autopost.get(ctx.state, ctx.chatId);
  const zone = ctx.config.bot.timezone;
  const duaEvery = post?.dua
    ? `🤲 دعاء ${autopost.everyHoursAr(post.dua.every)} — التالي ${autopost.describeNext(autopost.effectiveNext(post.dua, post.quiet, zone), zone)}`
    : "";
  if (!entry) return ["📿 الأذكار اليومية: *متوقفة* (off)", duaEvery, zoneLine(ctx)].filter(Boolean).join("\n");
  const lines = ["📿 *الأذكار اليومية* (on)"];
  if (entry.city) lines.push(`🏙️ ${entry.city}: الصباح بعد الفجر بنصف ساعة، والمساء بعد العصر بنصف ساعة (بتوقيت المدينة)`);
  else lines.push(`🌅 الصباح ${entry.morning || azkar.DEFAULTS.morning} · 🌇 المساء ${entry.evening || azkar.DEFAULTS.evening}`);
  lines.push(duaEvery || (entry.dua ? `🤲 دعاء يومي ${entry.dua}` : "🤲 دعاء: off"));
  lines.push(entry.sleep ? `🌙 أذكار النوم ${entry.sleep}` : "🌙 أذكار النوم: off");
  try {
    const n = await azkar.nextSend(entry, zone);
    const left = n.inMinutes >= 60 ? `${Math.floor(n.inMinutes / 60)} س ${n.inMinutes % 60} د` : `${n.inMinutes} د`;
    lines.push(`⏭️ التالي: ${KIND_AR[n.kind]} الساعة ${azkar.hhmm(n.at)} (بعد ${left})${n.zone !== zone ? ` بتوقيت ${n.zone}` : ""}`);
  } catch {
    /* city lookup failed: no "next" line */
  }
  lines.push(zoneLine(ctx));
  return lines.join("\n");
}

module.exports = [
  {
    name: "azkar",
    aliases: ["adhkar", "athkar", "zikr", "dhikr"],
    category: "islamic",
    description: "أذكار الصباح والمساء وغيرها من حصن المسلم — morning/evening adhkar and more from Hisn al-Muslim. Without a word: morning before noon, evening after.",
    usage: "[صباح|مساء|نوم|استيقاظ|صلاة]",
    examples: [".azkar", ".azkar صباح", ".azkar مساء", ".azkar نوم", ".azkar evening"],
    cooldown: 10,
    async run(ctx) {
      let kind = ctx.args[0] ? azkar.setFrom(ctx.args[0]) : null;
      if (ctx.args[0] && !kind) return ctx.reply(`اختر: صباح، مساء، نوم، استيقاظ، صلاة\nChoose: morning, evening, sleep, waking, prayer\nمثال: ${ctx.prefix}azkar مساء`);
      if (!kind) kind = zoneNow(ctx.config.bot.timezone, Date.now()).minutes < 12 * 60 ? "morning" : "evening";
      const friday = new Intl.DateTimeFormat("en-US", { timeZone: ctx.config.bot.timezone, weekday: "short" }).format(new Date()) === "Fri";
      return ctx.reply(azkar.setText(kind, { friday }));
    },
  },
  {
    name: "dua",
    aliases: ["doaa", "duaa", "doa", "dua2"],
    category: "islamic",
    description: "دعاء عشوائي من حصن المسلم، أو في موضوع معيّن — a random dua from Hisn al-Muslim, or on a topic (الكرب، الهم، الدين، الاستغفار …).",
    usage: "[موضوع]",
    examples: [".dua", ".dua الكرب", ".dua الهم", ".dua السفر"],
    cooldown: 5,
    async run(ctx) {
      const d = azkar.randomDua(ctx.text);
      if (!d) return ctx.reply(`لم أجد باباً بهذا الاسم. جرّب: الكرب، الهم، الدين، الاستغفار، السفر، المريض\n${ctx.prefix}hisn لعرض كل الأبواب`);
      return ctx.reply(azkar.duaText(d));
    },
  },
  {
    name: "hisn",
    aliases: ["hisnmuslim", "husn"],
    category: "islamic",
    description: "حصن المسلم: كل الأبواب (132)، أو باب برقمه أو بكلمة من عنوانه — browse all 132 chapters of Hisn al-Muslim by number or by a word.",
    usage: "[رقم | كلمة]",
    examples: [".hisn", ".hisn 35", ".hisn السفر"],
    cooldown: 5,
    async run(ctx) {
      const arg = ctx.text.trim();
      if (!arg) {
        const list = azkar.chapters().map((c) => `${c.id}. ${c.title}`);
        return ctx.reply(`📖 *حصن المسلم* — ${list.length} باباً\n\n${list.join("\n")}\n\n${ctx.prefix}hisn <رقم> لعرض باب`);
      }
      if (/^\d{1,3}$/.test(arg)) return ctx.reply(azkar.chapterText(Number(arg)) || "لا يوجد باب بهذا الرقم (1–132).");
      const found = azkar.searchChapters(arg);
      if (!found.length) return ctx.reply("لم أجد باباً بهذه الكلمة.");
      if (found.length === 1) return ctx.reply(azkar.chapterText(found[0].id));
      return ctx.reply(`📖 الأبواب المطابقة:\n\n${found.map((c) => `${c.id}. ${c.title}`).join("\n")}\n\n${ctx.prefix}hisn <رقم>`);
    },
  },
  {
    name: "autoazkar",
    aliases: ["dailyazkar", "azkarauto"],
    category: "islamic",
    description:
      "يرسل أذكار الصباح والمساء تلقائياً كل يوم في هذه المحادثة، ودعاءً يومياً إن شئت — sends the morning and evening adhkar here every day, the adhkar before sleep if you set a time, and a random dua once a day or every few hours. Set a city to follow prayer times. Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "on | off | morning <time> | evening <time> | dua <time|every N|off> | sleep <time|off> | city <city|off>",
    examples: [".autoazkar on", ".autoazkar city Cairo", ".autoazkar morning 06:00", ".autoazkar evening 16:30", ".autoazkar dua 21:00", ".autoazkar dua every 3", ".autoazkar sleep 22:30", ".autoazkar off"],
    cooldown: 3,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const value = ctx.args.slice(1).join(" ").trim();
      const zone = ctx.config.bot.timezone;
      const entry = azkar.getAuto(ctx.state, ctx.chatId);
      if (!sub || sub === "status") return ctx.reply(`${await autoStatus(ctx, entry)}\n\n${ctx.prefix}autoazkar on | off | city <مدينة> | morning 06:30 | evening 17:00 | dua 21:00 | sleep 22:30`);
      if (!(await canManage(ctx))) return ctx.reply(DENIED);

      // ".autoazkar dua every 3": a random dua every 3 hours (independent of the daily adhkar).
      const every = sub === "dua" && value.match(/^(?:every|كل)\s*(\d{1,2})\s*(?:h|hours?|ساعات|ساعة)?$/i);
      if (every) {
        const hours = Number(every[1]);
        if (hours < autopost.MIN_HOURS || hours > autopost.MAX_HOURS) throw new UserError(`اختر من ${autopost.MIN_HOURS} إلى ${autopost.MAX_HOURS} ساعة.`);
        try {
          // The first dua right away (asked for now), then every N hours.
          autopost.setEvery(ctx.state, ctx.chatId, "dua", hours, Date.now(), { sentNow: true });
        } catch {
          throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات. The bot already posts to the maximum number of chats.");
        }
        if (entry?.dua) azkar.setAuto(ctx.state, ctx.chatId, { dua: null }); // replaces the once-a-day dua
        await ctx.send(azkar.duaText(azkar.randomDua()));
        return ctx.reply(`✅ دعاء عشوائي ${autopost.everyHoursAr(hours)}.\n${await autoStatus(ctx, azkar.getAuto(ctx.state, ctx.chatId))}`);
      }
      if (sub === "off") {
        autopost.stop(ctx.state, ctx.chatId, "dua");
        azkar.removeAuto(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ تم إيقاف الأذكار اليومية. Daily adhkar turned off.");
      }
      const changes = {};
      if (sub === "on") {
        if (entry) return ctx.reply(await autoStatus(ctx, entry));
      } else if (sub === "morning" || sub === "evening" || sub === "dua" || sub === "sleep" || sub === "نوم") {
        const kind = sub === "نوم" ? "sleep" : sub;
        if ((kind === "dua" || kind === "sleep") && /^(off|stop|إيقاف)$/i.test(value)) {
          changes[kind] = null;
          if (kind === "dua") autopost.stop(ctx.state, ctx.chatId, "dua");
          if (!entry) return ctx.reply(kind === "dua" ? "⏹️ تم إيقاف الدعاء التلقائي." : "⏹️ تم إيقاف أذكار النوم.");
        }
        else {
          const min = parseClock(value);
          if (min === null) throw new UserError(`اكتب الوقت مثل 06:30 أو 9pm. Example: ${ctx.prefix}autoazkar ${kind} ${{ dua: "21:00", morning: "06:30", evening: "17:00", sleep: "22:30" }[kind]}`);
          changes[kind] = azkar.hhmm(min);
        }
      } else if (sub === "city") {
        changes.city = /^(off|none|إيقاف)$/i.test(value) || !value ? null : value.slice(0, 60);
        if (changes.city) {
          // Check the city now, so a typo is reported at once.
          try {
            await require("../../services/prayertimes").forCity(changes.city);
          } catch (err) {
            if (err instanceof UserError) throw err;
            throw new UserError("تعذّر الحصول على مواقيت الصلاة لهذه المدينة الآن. Couldn't get prayer times for that city.");
          }
        }
      } else {
        return ctx.reply(`الاستخدام: ${ctx.prefix}autoazkar on | off | city <مدينة> | morning 06:30 | evening 17:00 | dua 21:00 | dua off | sleep 22:30 | sleep off`);
      }
      let saved;
      try {
        saved = azkar.setAuto(ctx.state, ctx.chatId, changes);
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات التي ترسل إليها الأذكار. The bot already sends daily adhkar to the maximum number of chats.");
      }
      await azkar.skipPassed(ctx.state, ctx.chatId, zone);
      return ctx.reply(`✅ ${await autoStatus(ctx, saved)}`);
    },
  },
];
