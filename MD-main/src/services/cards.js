"use strict";

const { getBuffer } = require("../core/http");

/**
 * Picture cards (welcome/goodbye, rank) drawn on the server with sharp + SVG.
 * No third-party image API is involved, so member photos and names stay on the server.
 */

const W = 1000;
const H = 360;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters that are invalid in XML 1.0 would break the whole SVG.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const clip = (s, n) => {
  const chars = [...String(s ?? "")];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
};

/** The member's WhatsApp profile photo as a Buffer, or null. */
async function avatarOf(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, "image");
    if (!url) return null;
    return (await getBuffer(url, { maxBytes: 3 * 1024 * 1024, timeoutMs: 15000 })).buffer;
  } catch {
    return null;
  }
}

/** A round 220 px avatar (or a coloured circle with the initial). */
async function roundAvatar(avatar, initial, accent) {
  const sharp = require("sharp");
  const size = 220;
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  if (avatar) {
    try {
      return await sharp(avatar).resize(size, size, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    } catch {
      /* unreadable photo: fall back to the initial */
    }
  }
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="110" cy="110" r="110" fill="${accent}"/><text x="110" y="148" font-family="DejaVu Sans, Arial, sans-serif" font-size="110" font-weight="bold" fill="#fff" text-anchor="middle">${esc(initial)}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function background(accent) {
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16181d"/><stop offset="1" stop-color="#262a33"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="14" height="${H}" fill="${accent}"/>
  <circle cx="170" cy="180" r="122" fill="${accent}"/>`;
}

/**
 * @param {{ avatar?: Buffer|null, kind: "welcome"|"goodbye", name: string, group: string, members: number }} o
 * @returns {Promise<Buffer>} JPEG
 */
async function welcomeCard({ avatar, kind, name, group, members }) {
  const sharp = require("sharp");
  const accent = kind === "welcome" ? "#25d366" : "#ef5350";
  const title = kind === "welcome" ? "WELCOME" : "GOODBYE";
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${background(accent)}
  <text x="330" y="120" font-family="DejaVu Sans, Arial, sans-serif" font-size="64" font-weight="bold" fill="${accent}">${title}</text>
  <text x="330" y="190" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="bold" fill="#ffffff">${esc(clip(name, 22))}</text>
  <text x="330" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" fill="#b8bec9">${esc(clip(group, 34))}</text>
  <text x="330" y="300" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" fill="#8a919e">${kind === "welcome" ? `Member #${members}` : `${members} members left`}</text>
</svg>`;
  const face = await roundAvatar(avatar, [...String(name || "?")][0]?.toUpperCase() || "?", accent);
  return sharp(Buffer.from(svg))
    .composite([{ input: face, left: 60, top: 70 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * @param {{ avatar?: Buffer|null, name: string, level: number, rank: number, xp: number, current: number, needed: number, messages?: number }} o
 *   current/needed: XP into this level and XP needed for the next one
 */
async function rankCard({ avatar, name, level, rank, current, needed, xp }) {
  const sharp = require("sharp");
  const accent = "#7c4dff";
  const pct = Math.max(0, Math.min(1, needed ? current / needed : 0));
  const barW = 600;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${background(accent)}
  <text x="330" y="115" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="bold" fill="#ffffff">${esc(clip(name, 22))}</text>
  <text x="330" y="175" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="#b8bec9">Level <tspan font-weight="bold" fill="#ffffff">${level}</tspan>   ·   Rank <tspan font-weight="bold" fill="#ffffff">#${rank}</tspan></text>
  <rect x="330" y="215" width="${barW}" height="34" rx="17" fill="#3a3f4b"/>
  <rect x="330" y="215" width="${Math.max(34, Math.round(barW * pct))}" height="34" rx="17" fill="${accent}"/>
  <text x="330" y="295" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#8a919e">${current} / ${needed} XP to level ${level + 1}   ·   ${xp} XP total</text>
</svg>`;
  const face = await roundAvatar(avatar, [...String(name || "?")][0]?.toUpperCase() || "?", accent);
  return sharp(Buffer.from(svg))
    .composite([{ input: face, left: 60, top: 70 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { welcomeCard, rankCard, avatarOf, esc };
