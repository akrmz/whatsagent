"use strict";

const fs = require("node:fs");
const path = require("node:path");
const re = require("./realestate");
const { UserError } = require("../core/errors");

/**
 * A listing's videos, and changing its photos: deleting one, or choosing the cover (the first
 * photo, on its card, flyers and campaigns). Videos are kept as sent (an MP4/MOV, checked by its
 * file signature, not its name), at most 2 per listing and 16 MB each, next to the photos:
 *   DATA_DIR/listings/<id>/v<n>.mp4 · listing.videos = count
 */

const MAX_VIDEOS = 2;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

const videoPath = (config, id, n) => path.join(path.dirname(re.photoPath(config, id, 1)), `v${Number(n)}.mp4`);
const videos = (config, l) => Array.from({ length: l.videos || 0 }, (_, i) => videoPath(config, l.id, i + 1)).filter((p) => fs.existsSync(p));

/** An ISO media file (MP4, MOV, 3GP): "ftyp" at byte 4. WhatsApp's videos are all of these. */
const isVideo = (buf) => Buffer.isBuffer(buf) && buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp";

/** Checks a video before it is kept. @throws UserError */
function checkVideo(buf) {
  if (!isVideo(buf)) throw new UserError("That isn't a video file the bot can keep (MP4 or MOV).");
  if (buf.length > MAX_VIDEO_BYTES) throw new UserError(`A listing's video can be at most ${MAX_VIDEO_BYTES / 1048576} MB.`);
}

function addVideo(state, config, id, buf) {
  const l = re.get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  checkVideo(buf);
  const n = (l.videos || 0) + 1;
  if (n > MAX_VIDEOS) throw new UserError(`A listing can have ${MAX_VIDEOS} videos. Delete one first: .listing video ${id} del 1`);
  fs.mkdirSync(path.dirname(videoPath(config, id, n)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(videoPath(config, id, n), buf, { mode: 0o600 });
  re.update(state, id, { videos: n }, l.updated); // adding media isn't a change of the listing's details
  return n;
}

/** Removes the n-th file of a numbered series and moves the later ones down. */
function shiftDown(file, n, count) {
  fs.rmSync(file(n), { force: true });
  for (let i = n + 1; i <= count; i++) if (fs.existsSync(file(i))) fs.renameSync(file(i), file(i - 1));
}

function removeVideo(state, config, id, n) {
  const l = re.get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  if (!(n >= 1 && n <= (l.videos || 0))) throw new UserError(`#${id} has ${l.videos || 0} video(s).`);
  shiftDown((i) => videoPath(config, id, i), n, l.videos);
  re.update(state, id, { videos: l.videos - 1 }, l.updated);
}

function removePhoto(state, config, id, n) {
  const l = re.get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  if (!(n >= 1 && n <= (l.photos || 0))) throw new UserError(`#${id} has ${l.photos || 0} photo(s).`);
  shiftDown((i) => re.photoPath(config, id, i), n, l.photos);
  re.update(state, id, { photos: l.photos - 1 }, l.updated);
  require("./photohash").forget(state, id); // fingerprinted again in the background
  require("./brandphoto").clearCache(config, id);
}

/** The n-th photo becomes the first (the cover); the first takes its place. */
function setCover(state, config, id, n) {
  const l = re.get(state, id);
  if (!l) throw new UserError(`There is no listing #${id}.`);
  if (!(n >= 1 && n <= (l.photos || 0))) throw new UserError(`#${id} has ${l.photos || 0} photo(s).`);
  if (n === 1) return;
  const a = re.photoPath(config, id, 1);
  const b = re.photoPath(config, id, n);
  const tmp = `${a}.swap`;
  fs.renameSync(a, tmp);
  fs.renameSync(b, a);
  fs.renameSync(tmp, b);
  require("./photohash").forget(state, id);
  require("./brandphoto").clearCache(config, id);
}

module.exports = { addVideo, removeVideo, removePhoto, setCover, videos, videoPath, isVideo, checkVideo, MAX_VIDEOS, MAX_VIDEO_BYTES };
