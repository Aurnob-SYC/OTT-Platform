"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createInitialHlsReadiness,
  inspectHlsReadiness,
} = require("../src/hlsReadiness");

function createOutputDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ott-hls-readiness-"));
}

function writePlaylist(outputDir, relativePath) {
  const filePath = path.join(outputDir, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#EXTM3U\n");
}

test("creates initial HLS readiness details for a stream output directory", () => {
  const outputDir = createOutputDir();
  const readiness = createInitialHlsReadiness(outputDir);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.checkedAt, null);
  assert.equal(readiness.masterPlaylist.relativePath, "master.m3u8");
  assert.equal(readiness.masterPlaylist.exists, false);
  assert.deepEqual(readiness.missing, ["master.m3u8"]);
});

test("requires master and expected rendition playlists before HLS is ready", () => {
  const outputDir = createOutputDir();
  const stream = {
    output: {
      hlsOutputDir: outputDir,
    },
    encoder: {
      renditions: ["360p", "480p", "720p"],
    },
  };

  writePlaylist(outputDir, "master.m3u8");
  writePlaylist(outputDir, "360p/index.m3u8");

  const warmingUp = inspectHlsReadiness(stream, {
    now: () => "2026-01-01T00:00:00.000Z",
  });

  assert.equal(warmingUp.ready, false);
  assert.equal(warmingUp.masterPlaylist.usable, true);
  assert.deepEqual(warmingUp.missing, ["480p/index.m3u8", "720p/index.m3u8"]);

  writePlaylist(outputDir, "480p/index.m3u8");
  writePlaylist(outputDir, "720p/index.m3u8");

  const ready = inspectHlsReadiness(stream, {
    now: () => "2026-01-01T00:00:01.000Z",
  });

  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  assert.deepEqual(
    ready.renditions.map((rendition) => rendition.relativePath),
    ["360p/index.m3u8", "480p/index.m3u8", "720p/index.m3u8"],
  );
});
