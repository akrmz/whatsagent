"use strict";

const { UserError } = require("../core/errors");

/**
 * A group dhikr campaign (حملة ذكر): a shared goal such as 10,000 istighfar that members
 * add to (".hamla 100" or just "+100"). Stored in DATA_DIR/hamla.json as
 *   { [chat]: { round, dhikr, goal, total, by: { [jid]: count }, last: { [jid]: n }, started, finishedAt? } }
 */

const MIN_GOAL = 10;
const MAX_GOAL = 10_000_000;
const MAX_ADD = 10_000; // per message
const MAX_CHATS = 300;
const MILESTONES = [25, 50, 75];

/** Short names for the common adhkar; anything else is used as written. */
const PRESETS = {
  استغفار: "أستغفر الله",
  istighfar: "أستغفر الله",
  صلاة: "اللهم صلِّ وسلم على نبينا محمد",
  salawat: "اللهم صلِّ وسلم على نبينا محمد",
  تسبيح: "سبحان الله وبحمده",
  tasbih: "سبحان الله وبحمده",
  تهليل: "لا إله إلا الله",
  tahlil: "لا إله إلا الله",
  تكبير: "الله أكبر",
  takbir: "الله أكبر",
  حوقلة: "لا حول ولا قوة إلا بالله",
  hawqala: "لا حول ولا قوة إلا بالله",
};

const fmt = (n) => new Intl.NumberFormat("ar-EG").format(n);
const toNumber = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[,،٬]/g, ""));

const store = (state) => state.store("hamla", {});
const get = (state, chat) => store(state).data[chat] || null;
const active = (state, chat) => {
  const h = get(state, chat);
  return h && !h.finishedAt ? h : null;
};

function start(state, chat, { goal, dhikr }, now = Date.now()) {
  if (!Number.isInteger(goal) || goal < MIN_GOAL || goal > MAX_GOAL) throw new UserError(`الهدف من ${fmt(MIN_GOAL)} إلى ${fmt(MAX_GOAL)}.`);
  const text = PRESETS[String(dhikr || "").trim().toLowerCase()] || String(dhikr || "").trim() || PRESETS.استغفار;
  if (text.length > 80) throw new UserError("اسم الذكر طويل جداً (80 حرفاً على الأكثر).");
  return store(state).update((d) => {
    if (!d[chat] && Object.keys(d).length >= MAX_CHATS) throw new UserError("Too many groups have a campaign on this bot.");
    d[chat] = { round: (d[chat]?.round || 0) + 1, dhikr: text, goal, total: 0, by: {}, last: {}, started: now };
    return d[chat];
  });
}

/**
 * Adds a member's count.
 * @returns {{ total, goal, added, finished: boolean, milestone: number|null }}
 */
function add(state, chat, user, n, now = Date.now()) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_ADD) throw new UserError(`أضف عدداً من 1 إلى ${fmt(MAX_ADD)} في كل مرة.`);
  return store(state).update((d) => {
    const h = d[chat];
    if (!h || h.finishedAt) throw new UserError("لا توجد حملة جارية. ابدأ واحدة: .hamla new 10000 استغفار");
    const before = h.total;
    h.total += n;
    h.by[user] = (h.by[user] || 0) + n;
    h.last[user] = n;
    const pct = (x) => Math.floor((x / h.goal) * 100);
    const milestone = MILESTONES.find((m) => pct(before) < m && pct(h.total) >= m && h.total < h.goal) || null;
    const finished = h.total >= h.goal;
    if (finished) h.finishedAt = now;
    return { total: h.total, goal: h.goal, added: n, finished, milestone };
  });
}

/** Takes back a member's last addition (a typo). */
function undo(state, chat, user) {
  return store(state).update((d) => {
    const h = d[chat];
    const n = h?.last?.[user];
    if (!n || h.finishedAt) throw new UserError("لا توجد إضافة لك يمكن التراجع عنها.");
    h.total -= n;
    h.by[user] -= n;
    if (h.by[user] <= 0) delete h.by[user];
    delete h.last[user];
    return n;
  });
}

const remove = (state, chat) => store(state).update((d) => delete d[chat]);

/** Status text: progress bar, total, top readers. @returns {{ text, mentions }} */
function board(h, at, { top = 5 } = {}) {
  const ratio = Math.min(1, h.total / h.goal);
  const filled = Math.round(ratio * 10);
  const people = Object.entries(h.by).sort((a, b) => b[1] - a[1]);
  const lines = people.slice(0, top).map(([u, c], i) => `${["🥇", "🥈", "🥉"][i] || "▫️"} ${at(u)} — ${fmt(c)}`);
  const text = [
    `📿 *حملة ${h.dhikr}*${h.round > 1 ? ` (${fmt(h.round)})` : ""}`,
    `${"🟩".repeat(filled)}${"⬜".repeat(10 - filled)} ${fmt(Math.floor(ratio * 100))}٪`,
    `${fmt(h.total)} من ${fmt(h.goal)} · ${fmt(people.length)} مشارك`,
    lines.length ? `\n${lines.join("\n")}` : "",
    h.finishedAt ? "\n🎉 *اكتمل الهدف، تقبّل الله منكم!*" : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { text, mentions: people.slice(0, top).map(([u]) => u) };
}

/** "+100", "+ ١٠٠", "+1,000": a count sent as a plain message. */
const PLUS_RE = /^\+\s?([\d٠-٩][\d٠-٩,،٬]{0,7})$/;

module.exports = { get, active, start, add, undo, remove, board, fmt, toNumber, PRESETS, PLUS_RE, MAX_ADD, MIN_GOAL, MAX_GOAL };
