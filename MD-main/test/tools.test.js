"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { buildConfig, expandHome, toolPath } = require("../src/config");
const { explainFailure, probeTools } = require("../src/services/tools");

test("~ in paths is expanded to the home directory (shells do this, .env and spawn do not)", () => {
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("~/.local/bin/yt-dlp"), path.join(os.homedir(), ".local/bin/yt-dlp"));
  assert.equal(expandHome("/opt/yt-dlp"), "/opt/yt-dlp");
  assert.equal(expandHome("a~b"), "a~b");
  const c = buildConfig({ OWNER_NUMBERS: "201012345678", YTDLP_PATH: "~/.local/bin/yt-dlp", DATA_DIR: "~/botdata" });
  assert.equal(c.tools.ytdlp, path.resolve(os.homedir(), ".local/bin/yt-dlp"));
  assert.equal(c.paths.data, path.resolve(os.homedir(), "botdata"));
});

test("bare program names stay as-is so PATH lookup works", () => {
  assert.equal(toolPath("yt-dlp"), "yt-dlp");
  assert.equal(toolPath("ffmpeg"), "ffmpeg");
  assert.equal(toolPath("./bin/yt-dlp"), path.resolve("bin/yt-dlp"));
});

test("missing tools are explained precisely", () => {
  assert.match(explainFailure("yt-dlp", "YTDLP_PATH", { code: "ENOENT" }), /not found in PATH.*YTDLP_PATH/);
  assert.match(explainFailure("/nope/yt-dlp", "YTDLP_PATH", { code: "ENOENT" }), /does not exist\. Check YTDLP_PATH/);
  assert.match(explainFailure("/x/yt-dlp", "YTDLP_PATH", { code: "EACCES" }), /chmod \+x \/x\/yt-dlp/);
});

test("probeTools reports a missing yt-dlp with the path that was tried", async () => {
  const c = buildConfig({ OWNER_NUMBERS: "201012345678", YTDLP_PATH: "~/definitely-missing-dir/yt-dlp", FFMPEG_PATH: "no-such-ffmpeg-xyz" });
  const t = await probeTools(c);
  assert.equal(t.ytdlp.ok, false);
  assert.ok(t.ytdlp.problem.includes(path.join(os.homedir(), "definitely-missing-dir")));
  assert.equal(t.ffmpeg.ok, false);
});
