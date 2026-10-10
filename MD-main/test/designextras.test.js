"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const img = require("../src/services/reimages");
const english = require("../src/services/english");

const NOW = Date.parse("2026-10-10T12:00:00+03:00");
const agent = { name: "أحمد", phone: "+20 100 123 4567", currency: "جنيه" };
const chalet = { id: 12, type: "شاليه", deal: "بيع", location: "الساحل الشمالي", price: 9e6, size: 120, rooms: 2, down: 2e6, years: 5, delivery: 2027, features: ["صف أول", "فيو بحر", "حمام سباحة"], status: "available" };

test("flyers, stories and collages carry the payment plan, the delivery year and the features", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const d = img.details(chalet, agent);
  assert.equal(d.plan, "مقدم 2 مليون  ·  الباقي على 5 سنين  ·  استلام 2027");
  assert.equal(d.feats, "صف أول  ·  فيو بحر  ·  حمام سباحة");
  const e = english.details(chalet, agent);
  assert.equal(e.plan, "EGP 2M down  ·  the rest over 5 years  ·  delivery 2027");
  assert.equal(e.feats, "first row  ·  sea view  ·  pool");

  assert.deepEqual([img.details({ ...chalet, deal: "إيجار" }, agent).plan], [""], "no plan line for rentals");
  const plain = { id: 3, type: "شقة", deal: "بيع", location: "التجمع", price: 3e6, status: "available" };
  assert.deepEqual([img.details(plain, agent).plan, img.details(plain, agent).feats], ["", ""], "a cash unit without features: nothing extra");
  assert.equal(img.details({ ...chalet, down: undefined, years: undefined }, agent).plan, "استلام 2027", "the delivery alone");

  // They still draw at their sizes, with and without the extras.
  for (const [make, size] of [
    [() => img.flyer(chalet, agent, null), [1080, 1350]],
    [() => img.flyer(plain, agent, null), [1080, 1350]],
    [() => img.story(chalet, agent, null), [1080, 1920]],
    [() => img.flyer(chalet, agent, null, { lang: "en" }), [1080, 1350]],
  ]) {
    const meta = await sharp(await make()).metadata();
    assert.deepEqual([meta.width, meta.height], size);
  }
  t.mock.timers.reset();
});
