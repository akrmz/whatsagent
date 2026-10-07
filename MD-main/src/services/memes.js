"use strict";

const sharp = require("sharp");

/**
 * Classic meme captions (.smeme): bold white text with a black outline at the top and/or
 * bottom of a picture, drawn on the server with sharp (SVG text; Arabic is shaped by the
 * system's text engine). Latin text is upper-cased like the classic style.
 */

const esc = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);

/** Splits text into lines that fit roughly `maxChars` characters. */
function wrap(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

/** Font size and lines for one caption: as big as fits, smaller for long text (at most 4 lines). */
function layout(text, width) {
  for (let size = Math.round(width / 9); size >= Math.round(width / 28); size = Math.round(size * 0.88)) {
    const lines = wrap(text, Math.max(6, Math.floor(width / (size * 0.62))));
    if (lines.length <= 3) return { size, lines };
  }
  const size = Math.round(width / 28);
  return { size, lines: wrap(text, Math.floor(width / (size * 0.62))).slice(0, 4) };
}

function block(text, width, height, where) {
  const { size, lines } = layout(text, width);
  const lineH = size * 1.12;
  const top = where === "top" ? size * 0.25 + size : height - size * 0.35 - lineH * (lines.length - 1);
  return lines
    .map(
      (l, i) =>
        `<text x="${width / 2}" y="${(top + i * lineH).toFixed(1)}" font-size="${size}" text-anchor="middle" font-family="Impact, Anton, DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#ffffff" stroke="#000000" stroke-width="${Math.max(2, size / 14).toFixed(1)}" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`,
    )
    .join("");
}

const style = (t) => (/[a-z]/i.test(t) && !/[؀-ۿ]/.test(t) ? t.toUpperCase() : t);

/** @returns {Promise<Buffer>} JPEG */
async function caption(buffer, { top = "", bottom = "" }) {
  const base = sharp(buffer, { limitInputPixels: 64e6, animated: false }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: false });
  const { data, info } = await base.flatten({ background: "#ffffff" }).toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${top ? block(style(top), width, height, "top") : ""}${bottom ? block(style(bottom), width, height, "bottom") : ""}</svg>`;
  return sharp(data).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

/** ".smeme top text | bottom text", ".smeme | only bottom", ".smeme only top" */
function parseCaption(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const [top, bottom = ""] = t.split("|").map((s) => s.trim().slice(0, 120));
  return top || bottom ? { top, bottom } : null;
}

module.exports = { caption, parseCaption, wrap, layout };
