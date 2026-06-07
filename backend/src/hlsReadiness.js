"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MASTER_PLAYLIST = "master.m3u8";

function inspectPlaylist(outputDir, relativePath) {
  const playlistPath = path.join(outputDir, ...relativePath.split("/"));

  try {
    const stat = fs.statSync(playlistPath);
    const exists = stat.isFile();
    const sizeBytes = exists ? stat.size : 0;

    return {
      relativePath,
      path: playlistPath,
      exists,
      sizeBytes,
      usable: exists && sizeBytes > 0,
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        relativePath,
        path: playlistPath,
        exists: false,
        sizeBytes: 0,
        usable: false,
        error: error.message,
      };
    }

    return {
      relativePath,
      path: playlistPath,
      exists: false,
      sizeBytes: 0,
      usable: false,
    };
  }
}

function normalizeRenditions(renditions) {
  if (!Array.isArray(renditions)) {
    return [];
  }

  return renditions
    .map((rendition) => String(rendition).trim())
    .filter((rendition) => rendition !== "");
}

function createInitialHlsReadiness(outputDir) {
  return {
    ready: false,
    checkedAt: null,
    outputDir,
    masterPlaylist: {
      relativePath: MASTER_PLAYLIST,
      path: path.join(outputDir, MASTER_PLAYLIST),
      exists: false,
      sizeBytes: 0,
      usable: false,
    },
    renditions: [],
    missing: [MASTER_PLAYLIST],
  };
}

function inspectHlsReadiness(stream, options = {}) {
  const outputDir =
    options.outputDir ||
    (stream.output && stream.output.hlsOutputDir) ||
    stream.hlsOutputDir;
  const checkedAt = options.now ? options.now() : new Date().toISOString();
  const expectedRenditions = normalizeRenditions(
    options.renditions || (stream.encoder && stream.encoder.renditions),
  );
  const shouldCheckRenditions = options.checkRenditions !== false;
  const masterPlaylist = inspectPlaylist(outputDir, MASTER_PLAYLIST);
  const renditions = shouldCheckRenditions
    ? expectedRenditions.map((rendition) =>
        inspectPlaylist(outputDir, `${rendition}/index.m3u8`),
      )
    : [];
  const missing = [];

  if (!masterPlaylist.usable) {
    missing.push(MASTER_PLAYLIST);
  }

  for (const rendition of renditions) {
    if (!rendition.usable) {
      missing.push(rendition.relativePath);
    }
  }

  return {
    ready: missing.length === 0,
    checkedAt,
    outputDir,
    masterPlaylist,
    renditions,
    missing,
  };
}

module.exports = {
  MASTER_PLAYLIST,
  createInitialHlsReadiness,
  inspectHlsReadiness,
};
