"use strict";

const { UserError } = require("../core/errors");
const { parseAmount, latinDigits } = require("./realestate");

/** Real-estate calculators. Plain arithmetic, not financial advice. */

const FREQ = [
  ["monthly", 12, "شهري", /^(monthly|month|شهري|شهريا|شهرياً)$/],
  ["quarterly", 4, "ربع سنوي", /^(quarterly|quarter|ربع|ربع-سنوي|ربع_سنوي|ربعسنوي)$/],
  ["semiannual", 2, "نصف سنوي", /^(semiannual|semi|half|نصف|نصف-سنوي|نصف_سنوي)$/],
  ["yearly", 1, "سنوي", /^(yearly|annual|year|سنوي|سنويا|سنوياً)$/],
];

/** Words of the input, with "3.5 مليون" / "750 ألف" kept together as one amount. */
const words = (text) =>
  latinDigits(String(text || "").toLowerCase())
    .replace(/(\d)\s+(مليون|ملايين|million|ألف|الف|آلاف|الاف|thousand)(?=\s|$)/g, "$1$2")
    .split(/\s+/)
    .filter(Boolean);

/** "10%" → { pct: 10 }, "350k" → { amount: 350000 } */
function share(token, price) {
  const t = latinDigits(token);
  if (/%$/.test(t)) {
    const pct = Number(t.slice(0, -1));
    if (!(pct >= 0 && pct < 100)) throw new UserError("A percentage from 0 to 99%.");
    return { amount: (price * pct) / 100, pct };
  }
  const amount = parseAmount(t);
  if (amount === null || amount >= price) throw new UserError("The down payment must be a percentage (10%) or an amount below the price.");
  return { amount, pct: (amount / price) * 100 };
}

/**
 * Developer-style instalments (no interest): ".installments 3.5m 10% 8 quarterly maint 8%"
 * @returns {{ price, down, downPct, years, freq, perYear, count, each, remaining, maintenance, maintPct }}
 */
function installments(text) {
  const tokens = words(String(text || "").replace(/ربع سنوي/g, "ربع-سنوي").replace(/نصف سنوي/g, "نصف-سنوي"));
  const mi = tokens.findIndex((t) => /^(maint|maintenance|صيانة|صيانه|وديعة|وديعه)$/.test(t));
  let maintPct = 0;
  if (mi >= 0) {
    maintPct = Number(String(tokens[mi + 1] || "").replace("%", ""));
    if (!(maintPct >= 0 && maintPct <= 30)) throw new UserError("Maintenance: a percentage like 8%.");
    tokens.splice(mi, 2);
  }
  const fi = tokens.findIndex((t) => FREQ.some(([, , , re]) => re.test(t)));
  const freq = fi >= 0 ? FREQ.find(([, , , re]) => re.test(tokens[fi])) : FREQ[1]; // quarterly by default
  if (fi >= 0) tokens.splice(fi, 1);
  const [p, d, y] = tokens.map((t) => t.replace(/(years?|y|سنين|سنوات|سنة|سنه)$/, ""));
  const price = parseAmount(p || "");
  if (!price || !d || !y) throw new UserError("Usage: .installments <price> <down payment % or amount> <years> [monthly|quarterly|yearly] [maint 8%]\ne.g. .installments 3.5m 10% 8 quarterly maint 8%");
  const years = Number(y);
  if (!(years >= 1 && years <= 30) || !Number.isInteger(years)) throw new UserError("Years: a whole number from 1 to 30.");
  const down = share(d, price);
  const count = years * freq[1];
  const remaining = price - down.amount;
  return {
    price, down: down.amount, downPct: down.pct, years, freq: freq[2], perYear: freq[1], count,
    each: remaining / count, remaining, maintPct, maintenance: (price * maintPct) / 100,
  };
}

/** Bank loan (annuity): ".mortgage 3.5m 20% 25% 15" → price, down %, yearly interest %, years. */
function mortgage(text) {
  const t = words(text);
  const price = parseAmount(t[0] || "");
  if (!price || t.length < 4) throw new UserError("Usage: .mortgage <price> <down payment %> <yearly interest %> <years>\ne.g. .mortgage 3.5m 20% 25% 15");
  const down = share(t[1], price);
  const rate = Number(t[2].replace("%", ""));
  const years = Number(t[3].replace(/[^\d.]/g, ""));
  if (!(rate >= 0 && rate <= 60)) throw new UserError("Interest: a yearly percentage from 0 to 60%.");
  if (!(years >= 1 && years <= 30)) throw new UserError("Years: from 1 to 30.");
  const loan = price - down.amount;
  const n = Math.round(years * 12);
  const r = rate / 100 / 12;
  const monthly = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  return { price, down: down.amount, downPct: down.pct, loan, rate, years, months: n, monthly, total: monthly * n, interest: monthly * n - loan };
}

/** Price per square metre: ".ppm 3.5m 150" */
function ppm(text) {
  const t = words(text);
  const price = parseAmount(t[0] || "");
  const size = Number(String(t[1] || "").replace(/[^\d.]/g, ""));
  if (!price || !(size > 0)) throw new UserError("Usage: .ppm <price> <area m²>, e.g. .ppm 3.5m 150");
  return { price, size, perMeter: price / size };
}

/** Rental yield: ".roi 3.5m 25k" → price and monthly rent. */
function roi(text) {
  const t = words(text);
  const price = parseAmount(t[0] || "");
  const rent = parseAmount(t[1] || "");
  if (!price || !rent) throw new UserError("Usage: .roi <price> <monthly rent>, e.g. .roi 3.5m 25k");
  const yearly = rent * 12;
  return { price, rent, yearly, yieldPct: (yearly / price) * 100, payback: price / yearly };
}

module.exports = { installments, mortgage, ppm, roi };
