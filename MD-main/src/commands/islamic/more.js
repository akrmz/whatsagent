"use strict";

const { canManage, DENIED } = require("../../services/islamic-access");
const adhan = require("../../services/adhan");
const prayertimes = require("../../services/prayertimes");
const hijri = require("../../services/hijri");
const geo = require("../../services/geo");
const quran = require("../../services/quran");
const { getJson, request, HttpError } = require("../../core/http");
const { UserError } = require("../../core/errors");
const { LRU } = require("../../core/lru");

const cache = new LRU({ max: 50, ttlMs: 7 * 24 * 60 * 60 * 1000 });

async function cached(key, url) {
  const hit = cache.get(key);
  if (hit) return hit;
  const data = await getJson(url, { timeoutMs: 20000 });
  cache.set(key, data);
  return data;
}


/** "⏭️ أول تنبيه: العصر الساعة 15:32 (بعد 6 س 49 د) بتوقيت المدينة" */
function nextLine(p) {
  const n = adhan.nextPrayer(p);
  const left = n.inMinutes >= 60 ? `${Math.floor(n.inMinutes / 60)} س ${n.inMinutes % 60} د` : `${n.inMinutes} د`;
  return `⏭️ التنبيه التالي: ${prayertimes.AR[n.name]} الساعة ${prayertimes.hhmm(n.at)} (بعد ${left}) بتوقيت المدينة`;
}

const COMPASS = ["الشمال", "الشمال الشرقي", "الشرق", "الجنوب الشرقي", "الجنوب", "الجنوب الغربي", "الغرب", "الشمال الغربي"];

module.exports = [
  {
    name: "autoprayer",
    aliases: ["adhan", "azan", "prayeralert"],
    category: "islamic",
    description: "تنبيه بموعد كل صلاة من الصلوات الخمس في هذه المحادثة حسب مدينتك — announces each of the five prayers here, by your city's prayer times and time zone; \"azkar on\" also sends the adhkar after each prayer (25 minutes after the adhan by default). Anyone in the group can set it (unless ISLAMIC_ADMIN_ONLY is on).",
    usage: "on <city> | azkar on [minutes 10-60] | azkar off | off",
    examples: [".autoprayer on Cairo", ".autoprayer on مكة", ".autoprayer azkar on", ".autoprayer azkar on 20", ".autoprayer off", ".autoprayer"],
    cooldown: 5,
    async run(ctx) {
      const sub = (ctx.args[0] || "").toLowerCase();
      const city = ctx.args.slice(1).join(" ").trim().slice(0, 60);
      const entry = adhan.get(ctx.state, ctx.chatId);
      if (!sub) {
        if (!entry) return ctx.reply(`🕌 تنبيهات الصلاة: *متوقفة*\nللتشغيل: ${ctx.prefix}autoprayer on <المدينة>`);
        const next = await prayertimes
          .forCity(entry.city)
          .then((p) => `\n${nextLine(p)}`)
          .catch(() => "");
        const after = entry.after ? `📿 أذكار بعد الصلاة: بعد الأذان بـ${entry.after} دقيقة` : `📿 أذكار بعد الصلاة: off (${ctx.prefix}autoprayer azkar on)`;
        return ctx.reply(`🕌 تنبيهات الصلاة: *تعمل* — ${entry.city}${next}\n${after}\n${ctx.prefix}autoprayer off للإيقاف`);
      }
      if (!(await canManage(ctx))) return ctx.reply(DENIED);
      if (sub === "off") {
        adhan.remove(ctx.state, ctx.chatId);
        return ctx.reply("⏹️ تم إيقاف تنبيهات الصلاة. Prayer alerts turned off.");
      }
      if (sub === "azkar" || sub === "adhkar" || sub === "أذكار") {
        if (!entry) return ctx.reply(`شغّل تنبيهات الصلاة أولاً: ${ctx.prefix}autoprayer on <المدينة>`);
        const mode = String(ctx.args[1] || "").toLowerCase();
        if (mode === "off") {
          adhan.setAfter(ctx.state, ctx.chatId, null);
          return ctx.reply("⏹️ تم إيقاف أذكار ما بعد الصلاة.");
        }
        if (mode !== "on") return ctx.reply(`الاستخدام: ${ctx.prefix}autoprayer azkar on [${adhan.AFTER_MIN}-${adhan.AFTER_MAX}] | azkar off`);
        const n = ctx.args[2] === undefined ? adhan.AFTER_DEFAULT : Number(ctx.args[2]);
        if (!Number.isInteger(n) || n < adhan.AFTER_MIN || n > adhan.AFTER_MAX) throw new UserError(`عدد الدقائق بعد الأذان من ${adhan.AFTER_MIN} إلى ${adhan.AFTER_MAX}.`);
        adhan.setAfter(ctx.state, ctx.chatId, n);
        await adhan.skipPassed(ctx.state, ctx.chatId);
        return ctx.reply(`✅ أذكار ما بعد الصلاة تُرسل بعد كل أذان بـ${n} دقيقة (من حصن المسلم؛ الأذكار الخاصة بالفجر والمغرب بعدهما فقط).`);
      }
      if (sub !== "on" || !city) return ctx.reply(`الاستخدام: ${ctx.prefix}autoprayer on <المدينة> | azkar on | off`);
      let p;
      try {
        p = await prayertimes.forCity(city);
      } catch (err) {
        if (err instanceof UserError) throw err;
        throw new UserError("تعذّر الحصول على مواقيت الصلاة لهذه المدينة الآن. Couldn't get prayer times for that city.");
      }
      try {
        adhan.set(ctx.state, ctx.chatId, city);
      } catch {
        throw new UserError("وصل البوت إلى الحد الأقصى من المحادثات. The bot already sends prayer alerts to the maximum number of chats.");
      }
      await adhan.skipPassed(ctx.state, ctx.chatId);
      const lines = prayertimes.PRAYERS.map((n) => `▫️ ${prayertimes.AR[n]}: ${prayertimes.hhmm(p.times[n])}`);
      return ctx.reply(`✅ تنبيهات الصلاة تعمل — *${p.city}* (${p.zone})\n\nمواقيت اليوم:\n${lines.join("\n")}\n\n${nextLine(p)}${p.method ? `\n_${p.method}_` : ""}`);
    },
  },
  {
    name: "hijri",
    aliases: ["hijridate", "islamicdate"],
    category: "islamic",
    description: "التاريخ الهجري اليوم (تقويم أم القرى) — today's Hijri date (Umm al-Qura).",
    cooldown: 5,
    async run(ctx) {
      const zone = ctx.config.bot.timezone;
      const now = new Date();
      const h = hijri.toHijri(now, zone);
      const g = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
      return ctx.reply(`📅 *${hijri.format(h)}*\n${g}\n\n_تقويم أم القرى — قد تختلف بداية الشهر يوماً حسب رؤية الهلال._`);
    },
  },
  {
    name: "ramadan",
    aliases: ["occasions", "eid", "mawasim"],
    category: "islamic",
    description: "كم بقي على رمضان والعيدين ويوم عرفة وعاشوراء ورأس السنة الهجرية — countdown to Ramadan, the Eids and other Islamic occasions.",
    cooldown: 5,
    async run(ctx) {
      const list = hijri.upcoming(new Date(), ctx.config.bot.timezone);
      const lines = list.map((o) => {
        const when = o.days === 0 ? "*اليوم* 🎉" : o.days === 1 ? "غداً" : `بعد *${o.days}* يوماً`;
        return `• ${o.name}: ${when} (${o.date.toISOString().slice(0, 10)})`;
      });
      return ctx.reply(`🌙 *المواسم القادمة*\n\n${lines.join("\n")}\n\n_تقويم أم القرى — الموعد الفعلي قد يختلف يوماً حسب رؤية الهلال._`);
    },
  },
  {
    name: "tafsir",
    aliases: ["tafseer", "muyassar"],
    category: "islamic",
    description: "الآية مع تفسيرها من التفسير الميسر، أو آية عشوائية — a verse with its explanation from al-Tafsir al-Muyassar (random without a reference). For automatic posts see .autotafsir.",
    usage: "[سورة:آية | اسم السورة رقم الآية]",
    examples: [".tafsir 2:255", ".tafsir البقرة 255", ".tafsir"],
    cooldown: 5,
    externalService: "alquran.cloud",
    async run(ctx) {
      const ref = ctx.text.trim();
      // No reference: a random verse.
      if (!ref) return ctx.reply(await quran.randomAyahTafsir());
      const parsed = quran.parseRef(ref);
      if (!parsed) return ctx.reply(`الاستخدام: ${ctx.prefix}tafsir 2:255 أو ${ctx.prefix}tafsir البقرة 255 (أو بدون رقم لآية عشوائية)`);
      return ctx.reply(await quran.ayahWithTafsir(parsed.ref));
    },
  },
  {
    name: "surah",
    aliases: ["sura", "tilawa"],
    category: "islamic",
    description: "تلاوة سورة كاملة بصوت الشيخ مشاري العفاسي، بالاسم أو الرقم — a full surah recited by Mishary Alafasy (by name or number). Long surahs come as a link.",
    usage: "<اسم السورة | رقمها>",
    examples: [".surah الكهف", ".surah 36", ".surah yaseen"],
    cooldown: 20,
    externalService: "alquran.cloud, cdn.islamic.network",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`الاستخدام: ${ctx.prefix}surah الكهف أو ${ctx.prefix}surah 18`);
      const s = quran.findSurah(ctx.text);
      if (!s) return ctx.reply("لم أجد سورة بهذا الاسم. جرّب الرقم، مثل: .surah 18");
      const url = `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${s.number}.mp3`;
      const info = `📖 *${s.name}* (${s.number}) — ${s.numberOfAyahs} آية، ${s.revelationType === "Meccan" ? "مكية" : "مدنية"}\n🎙️ مشاري العفاسي`;
      await ctx.react("🎧");
      let audio;
      try {
        // "identity": the CDN then states the size, so a too-long surah is refused before downloading.
        audio = await request(url, { timeoutMs: 180000, maxBytes: ctx.config.limits.downloadBytes, headers: { "accept-encoding": "identity" } });
      } catch (err) {
        if (err instanceof HttpError && err.code === "TOO_LARGE") return ctx.reply(`${info}\n\nالتلاوة أطول من حد التحميل — استمع هنا:\n${url}`);
        throw err;
      }
      await ctx.reply(info);
      return ctx.reply({ audio: audio.body, mimetype: "audio/mpeg", fileName: `${s.number}-${s.englishName}.mp3` });
    },
  },
  {
    name: "qibla",
    aliases: ["kibla"],
    category: "islamic",
    description: "اتجاه القبلة من مدينة — the Qibla direction from a city (degrees from north).",
    usage: "<المدينة>",
    examples: [".qibla Cairo", ".qibla London"],
    cooldown: 5,
    externalService: "aladhan.com, open-meteo.com (city lookup)",
    async run(ctx) {
      if (!ctx.text) return ctx.reply(`الاستخدام: ${ctx.prefix}qibla <المدينة>`);
      const place = await geo.geocode(ctx.text);
      const res = await getJson(`https://api.aladhan.com/v1/qibla/${place.latitude}/${place.longitude}`, { timeoutMs: 15000 });
      const deg = res.data?.direction;
      if (!Number.isFinite(deg)) return ctx.reply("تعذّر حساب اتجاه القبلة الآن.");
      const side = COMPASS[Math.round(deg / 45) % 8];
      return ctx.reply(`🕋 *اتجاه القبلة من ${geo.label(place)}*\n\n${deg.toFixed(1)}° من الشمال باتجاه عقارب الساعة (نحو ${side})\n\n_استخدم بوصلة الهاتف: وجّه الهاتف نحو ${Math.round(deg)}°._`);
    },
  },
  {
    name: "asma",
    aliases: ["asmaulhusna", "names99", "asmaallah"],
    category: "islamic",
    description: "من أسماء الله الحسنى — a name of Allah from al-Asma' al-Husna (random, by number 1-99, or \"all\").",
    usage: "[رقم | all]",
    examples: [".asma", ".asma 1", ".asma all"],
    cooldown: 5,
    externalService: "aladhan.com",
    async run(ctx) {
      const names = (await cached("asma", "https://api.aladhan.com/v1/asmaAlHusna")).data || [];
      if (names.length !== 99) throw new UserError("تعذّر تحميل الأسماء الآن.");
      const arg = (ctx.args[0] || "").toLowerCase();
      if (arg === "all" || arg === "الكل") {
        return ctx.reply(`✨ *أسماء الله الحسنى*\n\n${names.map((n) => `${n.number}. ${n.name}`).join("\n")}`);
      }
      const n = arg ? Number(arg) : 1 + Math.floor(Math.random() * 99);
      const item = names.find((x) => x.number === n);
      if (!item) return ctx.reply(`اكتب رقماً من 1 إلى 99، أو ${ctx.prefix}asma all`);
      return ctx.reply(`✨ *${item.name}*\n${item.number} من 99 · ${item.transliteration} — _${item.en?.meaning || ""}_`);
    },
  },
];
