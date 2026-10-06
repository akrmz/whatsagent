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

module.exports = { canManage, DENIED };
