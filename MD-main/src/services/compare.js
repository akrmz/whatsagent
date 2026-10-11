"use strict";

const re = require("./realestate");
const market = require("./market");
const places = require("./places");

/**
 * 2 to 4 listings side by side as text: price, size, price per m², rooms, baths, floor,
 * finishing and status, the best value of each row marked ✅ (".compare 3 7", and a client's
 * "قارن #3 و #7"). `footer`: what to send next, for the reader.
 */
function compareText(state, list, { footer } = {}) {
  const c = re.agent(state).currency;
  const best = (values, pick) => {
    const nums = values.filter((v) => typeof v === "number");
    if (nums.length < 2 || nums.every((v) => v === nums[0])) return null;
    return pick === "min" ? Math.min(...nums) : Math.max(...nums);
  };
  const row = (icon, label, values, { fmt = String, pick } = {}) => {
    if (values.every((v) => v === undefined || v === null || v === "")) return null;
    const b = pick ? best(values, pick) : null;
    return `${icon} ${label}: ${list.map((l, i) => `#${l.id} ${values[i] === undefined || values[i] === null || values[i] === "" ? "—" : fmt(values[i])}${b !== null && values[i] === b ? " ✅" : ""}`).join(" | ")}`;
  };
  const lines = [
    `⚖️ *مقارنة* ${list.map((l) => `#${l.id}`).join(" · ")}`,
    "",
    row("🏠", "النوع", list.map((l) => `${l.type || "عقار"} لل${l.deal || "بيع"}`)),
    row("📍", "المنطقة", list.map((l) => l.location && l.location.slice(0, 30))),
    row("💰", "السعر", list.map((l) => l.price), { fmt: (v) => re.shortAr(v), pick: "min" }),
    row("📐", "المساحة", list.map((l) => l.size), { fmt: (v) => `${re.group(v)} م²`, pick: "max" }),
    row("💵", "سعر المتر", list.map((l) => (market.ppm(l) ? Math.round(market.ppm(l)) : null)), { fmt: (v) => re.group(v), pick: "min" }),
    row("🛏", "الغرف", list.map((l) => l.rooms), { pick: "max" }),
    row("🛁", "الحمامات", list.map((l) => l.baths), { pick: "max" }),
    row("🏢", "الدور", list.map((l) => l.floor)),
    row("✨", "التشطيب", list.map((l) => l.finishing)),
    row("🔖", "الحالة", list.map((l) => re.STATUS_AR[l.status] || l.status)),
  ];
  if (list.length === 2 && list[0].geo && list[1].geo) lines.push(`📏 المسافة بينهما: ${places.km(places.distanceKm(list[0].geo, list[1].geo))}`);
  lines.push("", `✅ = الأفضل (أقل سعر، أكبر مساحة …)${footer ? ` · ${footer}` : ""} · العملة: ${c}`);
  return lines.filter((x) => x !== null).join("\n");
}

module.exports = { compareText };
