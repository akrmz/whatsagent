"use strict";

const sharp = require("sharp");
const { UserError } = require("../core/errors");

/** Colour codes (.color): parse, convert, and draw a swatch locally with sharp. */

const NAMES = {
  black: "000000", white: "ffffff", red: "ff0000", green: "008000", lime: "00ff00", blue: "0000ff", yellow: "ffff00",
  cyan: "00ffff", magenta: "ff00ff", gray: "808080", grey: "808080", silver: "c0c0c0", maroon: "800000", olive: "808000",
  purple: "800080", teal: "008080", navy: "000080", orange: "ffa500", pink: "ffc0cb", brown: "a52a2a", gold: "ffd700",
  beige: "f5f5dc", coral: "ff7f50", crimson: "dc143c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
  mint: "98ff98", salmon: "fa8072", skyblue: "87ceeb", tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3",
};

/** "#1e90ff", "1e90ff", "#09f", "rgb(30, 144, 255)", "30 144 255", "orange" → { r, g, b } */
function parseColor(text) {
  const s = String(text || "").trim().toLowerCase();
  if (NAMES[s.replace(/\s+/g, "")]) return parseColor(NAMES[s.replace(/\s+/g, "")]);
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  m = s.match(/^(?:rgb\s*\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/);
  if (m && m.slice(1).every((v) => Number(v) <= 255)) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  throw new UserError("Give a colour as #1e90ff, #09f, rgb(30,144,255) or a name like orange.");
}

const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function hsl({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** WCAG relative luminance and the more readable text colour on this background. */
function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

function describe(c) {
  const L = luminance(c);
  const onWhite = contrast(L, 1);
  const onBlack = contrast(L, 0);
  const { h, s, l } = hsl(c);
  return {
    hex: hex(c),
    rgb: `rgb(${c.r}, ${c.g}, ${c.b})`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`,
    text: onBlack >= onWhite ? "black" : "white",
    onWhite: onWhite.toFixed(2),
    onBlack: onBlack.toFixed(2),
  };
}

/** A 600×300 PNG: the colour, with its codes written in the readable text colour. */
async function swatch(c) {
  const d = describe(c);
  const fg = d.text === "black" ? "#000000" : "#ffffff";
  const svg = `<svg width="600" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="300" fill="${d.hex}"/>
  <text x="40" y="150" font-family="DejaVu Sans, Arial, sans-serif" font-size="64" font-weight="bold" fill="${fg}">${d.hex.toUpperCase()}</text>
  <text x="40" y="210" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="${fg}">${d.rgb}</text>
  <text x="40" y="255" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="${fg}">${d.hsl}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { parseColor, hex, hsl, describe, swatch, luminance };
