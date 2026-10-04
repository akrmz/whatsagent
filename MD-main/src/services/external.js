"use strict";

const { getJson, getBuffer, request, multipart, HttpError } = require("../core/http");
const { sniff } = require("../core/media");

/**
 * Thin wrappers for the free third-party APIs some fun/image commands use.
 * Every call goes through the SSRF-safe client with size and time limits.
 */

const encode = encodeURIComponent;

/** Text from the shizo demo API (dare, truth, flirt, quotes, shayari, lovenight). */
async function shizoText(kind) {
  const data = await getJson(`https://shizoapi.onrender.com/api/texts/${kind}?apikey=shizo`);
  if (!data?.result) throw new HttpError("No text returned", { code: "EMPTY" });
  return String(data.result);
}

/** Downloads an image and verifies it really is an image (not an HTML error page). */
async function getImage(url, { maxBytes = 8 * 1024 * 1024, timeoutMs = 30000 } = {}) {
  const { buffer } = await getBuffer(url, { maxBytes, timeoutMs });
  const kind = sniff(buffer);
  if (!["png", "jpeg", "gif", "webp"].includes(kind)) throw new HttpError("The service did not return an image", { code: "NOT_IMAGE" });
  return buffer;
}

/** some-random-api.com image effects. `params` are query parameters (avatar etc.). */
async function someRandomApi(pathname, params) {
  const qs = new URLSearchParams(params).toString();
  return getImage(`https://api.some-random-api.com/${pathname}?${qs}`);
}

// ---- Public file hosts. Anything uploaded here becomes publicly accessible. ----

async function uploadTelegraph(buffer, filename, contentType) {
  const form = multipart([{ name: "file", value: buffer, filename, contentType }]);
  const res = await request("https://telegra.ph/upload", {
    method: "POST",
    headers: { "content-type": form.contentType },
    body: form.body,
    maxBytes: 64 * 1024,
  });
  const data = JSON.parse(res.body.toString("utf8"));
  if (!Array.isArray(data) || !data[0]?.src) throw new HttpError("telegra.ph upload failed", { code: "UPLOAD" });
  return `https://telegra.ph${data[0].src}`;
}

async function uploadPomf(host, buffer, filename, contentType) {
  const form = multipart([{ name: "files[]", value: buffer, filename, contentType }]);
  const res = await request(`https://${host}/upload.php`, {
    method: "POST",
    headers: { "content-type": form.contentType },
    body: form.body,
    maxBytes: 64 * 1024,
    timeoutMs: 60000,
  });
  const data = JSON.parse(res.body.toString("utf8"));
  const url = data?.files?.[0]?.url;
  if (!url) throw new HttpError(`${host} upload failed`, { code: "UPLOAD" });
  return url;
}

/** Uploads to the first public host that works. Returns a public URL. */
async function uploadPublic(buffer, { filename = "file.bin", contentType = "application/octet-stream" } = {}) {
  const hosts = [
    () => uploadPomf("qu.ax", buffer, filename, contentType),
    () => uploadPomf("uguu.se", buffer, filename, contentType),
    () => uploadTelegraph(buffer, filename, contentType),
  ];
  let lastError;
  for (const tryHost of hosts) {
    try {
      return await tryHost();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Returns a public image URL for "the picture this command is about": an image in or
 * replied to by the message (uploaded to a public host), else the profile picture of
 * the mentioned/replied user or the sender.
 */
async function avatarOrImageUrl(ctx) {
  const media = ctx.findMedia({ types: ["image"] });
  if (media) {
    const buffer = await ctx.download(media, 8 * 1024 * 1024);
    return uploadPublic(buffer, { filename: "image.jpg", contentType: media.mimetype || "image/jpeg" });
  }
  const who = ctx.target() || ctx.sender;
  try {
    return await ctx.sock.profilePictureUrl(who, "image");
  } catch {
    return "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Default_pfp.jpg/240px-Default_pfp.jpg";
  }
}

module.exports = { shizoText, getImage, someRandomApi, uploadPublic, avatarOrImageUrl, encode };
