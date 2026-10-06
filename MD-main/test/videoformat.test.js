"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCodecs, videoPlan } = require("../src/core/media");
const ytdlp = require("../src/services/ytdlp");

// ffmpeg's stream list for a Facebook DASH merge (AV1 + AAC), as printed on 2026-10-06.
const FB_AV1 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'av1.mp4':
  Duration: 00:00:22.97, start: 0.000000, bitrate: 792 kb/s
  Stream #0:0[0x1](und): Video: av1 (libdav1d) (Main) (av01 / 0x31307661), yuv420p(tv, bt709), 720x1280, 714 kb/s, 30 fps (default)
  Stream #0:1[0x2](und): Audio: aac (HE-AAC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 74 kb/s (default)
At least one output file must be specified`;
const FB_HD = `  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 720x1280, 1998 kb/s, 30 fps
  Stream #0:1[0x2](und): Audio: aac (HE-AAC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 74 kb/s (default)`;
const WEBM = `  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv), 1280x720
  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)`;
const MKV_H264 = `  Stream #0:0: Video: h264 (High), yuv420p, 1280x720
  Stream #0:1: Audio: aac (LC), 44100 Hz, stereo`;

test("WhatsApp-playable check: AV1/VP9 are converted, H.264+AAC MP4 is left alone", () => {
  assert.deepEqual(parseCodecs(FB_AV1), { video: "av1", audio: "aac" });
  assert.deepEqual(parseCodecs(FB_HD), { video: "h264", audio: "aac" });
  assert.equal(videoPlan(parseCodecs(FB_AV1), "mp4"), "convert", "the Facebook case that showed 'something is wrong with the video file'");
  assert.equal(videoPlan(parseCodecs(FB_HD), "mp4"), "ok");
  assert.equal(videoPlan(parseCodecs(WEBM), "webm"), "convert");
  assert.equal(videoPlan(parseCodecs(MKV_H264), "mkv"), "remux", "right codecs, wrong container: no re-encode");
  assert.equal(videoPlan({ video: "h264", audio: "opus" }, "mp4"), "convert", "audio WhatsApp can't play");
  assert.equal(videoPlan({ video: "h264", audio: null }, "mp4"), "ok", "a silent clip");
  assert.equal(videoPlan({ video: null, audio: null }, "mp4"), "ok", "unreadable: sent as before");
});

test("format choice prefers H.264 and ready-made MP4 files before anything that needs converting", () => {
  const steps = ytdlp.VIDEO_FORMAT.split("/");
  assert.match(steps[0], /^b\[ext=mp4\]\[vcodec\^=avc\]/, "a ready-made H.264 MP4 first (as small as before for YouTube)");
  const anyMerge = steps.indexOf("bv*[height<=?720]+ba");
  const fbReadyMade = steps.indexOf("b[ext=mp4][height<=?720]");
  assert.ok(fbReadyMade > -1 && anyMerge > fbReadyMade, "Facebook's hd/sd file before its AV1 streams");
  assert.ok(steps.slice(0, anyMerge).every((s) => s.includes("avc") || s.startsWith("b[ext=mp4]")), "nothing non-H.264 before that");
  assert.ok(!ytdlp.VIDEO_FORMAT_NO_FFMPEG.includes("+"), "without ffmpeg: single files only");
});
