"use strict";

/**
 * Who may turn the automatic Islamic posts (.autoazkar, .autoprayer, .autotafsir) on or
 * off in a group. By default every member may; with ISLAMIC_ADMIN_ONLY=true only group
 * admins (and the owner/sudo). In a private chat it is always the person's own choice.
 */
async function canManage(ctx) {
  if (!ctx.isGroup || ctx.isSudoOrOwner || !ctx.config.islamic.adminOnly) return true;
  return ctx.isSenderAdmin();
}

const DENIED = "❌ في هذه المجموعة المشرفون فقط يغيّرون هذا الإعداد. Only group admins can change this here.";

const SOURCE_AR = { TIMEZONE: "", "owner number": " — حسب رقم المالك", server: " — توقيت الخادم" };

/**
 * "🕒 Africa/Cairo — 08:43" plus a warning when the bot is on UTC only because the server
 * is (times like 06:30 would then be 06:30 UTC).
 */
function zoneLine(ctx) {
  const { timezone, timezoneSource } = ctx.config.bot;
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const line = `🕒 توقيت البوت: ${timezone} (الآن ${now})${SOURCE_AR[timezoneSource] || ""}`;
  if (timezoneSource === "server" && /UTC|GMT|Universal|Zulu/i.test(timezone)) {
    return `${line}\n⚠️ إن لم يكن هذا توقيتك فاضبطه: ${ctx.prefix}setvar TIMEZONE Africa/Cairo`;
  }
  return line;
}

module.exports = { canManage, DENIED, zoneLine };
