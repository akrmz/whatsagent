"use strict";

const re = require("../services/realestate");
const { compareText } = require("../services/compare");
const { show, captureInquiry } = require("../services/listingview");
const { allowLookup } = require("../services/lookuplimits");

// What may stand around the codes: "#3 و #7", "قارن #3 و #7", "الفرق بين #3 و #7 ايه؟", "#3 #7 #12".
const FILLER = new Set(["و", "او", "أو", "ولا", "قارن", "قارنلي", "قارني", "مقارنة", "مقارنه", "compare", "vs", "and", "or", "بين", "الفرق", "والفرق", "ايه", "إيه", "تفاصيل", "عايز", "عاوز", "ابعتلي", "الوحدات", "وحدات", "دول", "دي", "ده"]);
const MAX_TEXT = 200;

/**
 * "#3 و #7" → { ids: [3, 7] }: 2 to 5 different codes and nothing else but the words above
 * (anything more is a question for someone, or for the assistant). @returns {{ ids: number[] } | null}
 */
function codesIn(text) {
  const t = re.latinDigits(re.squeeze(String(text || "")));
  if (!t || t.length > MAX_TEXT) return null;
  const ids = [];
  const rest = t.replace(/#\s?(\d{1,5})/g, (_, n) => {
    ids.push(Number(n));
    return " ";
  });
  if (!rest.split(/[\s،,؟?!.\-+&|/]+/).every((w) => !w || FILLER.has(w.toLowerCase()))) return null;
  const unique = [...new Set(ids)];
  return unique.length >= 2 && unique.length <= 5 ? { ids: unique } : null;
}

/**
 * Several listings' codes in one private message (copied from a status or a group post, or
 * "قارن #3 و #7"): 2 to 4 come side by side (.compare's table), 5 as one line each, then "#3"
 * for photos and details. Codes that aren't listings are left out; if one is left, its card.
 * With .agent autoleads on, each is noted as a question about that unit.
 */
module.exports = {
  name: "multi-code",
  event: "message",
  phase: "post",
  priority: 21,
  privateOnly: true,
  publicOnly: true,
  async run(ctx) {
    if (ctx.fromMe) return undefined;
    const found = codesIn(ctx.body);
    if (!found) return undefined;
    const list = found.ids.map((id) => re.get(ctx.state, id)).filter(Boolean);
    if (!list.length) return undefined;
    if (!allowLookup(ctx, `codes:${list.map((l) => l.id).join(",")}`)) return "stop"; // flood: silent
    if (list.length === 1) {
      // "#3 #99": the one that exists, as "#3" would.
      await show(ctx, list[0]);
      await captureInquiry(ctx, list[0]);
      return "stop";
    }
    const next = `ابعت رقم الوحدة زي #${list[0].id} وتوصلك صورها وتفاصيلها`;
    if (list.length <= 4) await ctx.reply(compareText(ctx.state, list, { footer: next }));
    else {
      const cur = re.agent(ctx.state).currency;
      await ctx.reply(`🏠 *الوحدات اللي طلبتها:*\n\n${list.map((l) => re.line(l, cur)).join("\n")}\n\n${next}`);
    }
    for (const l of list) await captureInquiry(ctx, l);
    return "stop";
  },
  codesIn,
};
