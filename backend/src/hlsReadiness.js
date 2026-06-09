"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MASTER_PLAYLIST = "master.m3u8";

/**
 * Checks whether a playlist file exists and whether it is usable for playback.
 * @param {string} outputDir - Base HLS output directory for the stream.
 * @param {string} relativePath - Playlist path relative to the output directory.
 * @returns {{relativePath: string, path: string, exists: boolean, sizeBytes: number, usable: boolean, error?: string}} File inspection details.
 */
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

/**
 * Normalizes a renditions list into trimmed, non-empty strings.
 * @param {unknown} renditions - The renditions value received from stream state or options.
 * @returns {string[]} A cleaned list of rendition names.
 */
function normalizeRenditions(renditions) {
  if (!Array.isArray(renditions)) {
    return [];
  }

  return renditions
    .map((rendition) => String(rendition).trim())
    .filter((rendition) => rendition !== "");
}

/**
 * Builds the default unreadiness state for a stream before playlists exist.
 * @param {string} outputDir - HLS output directory being checked.
 * @returns {object} A readiness object describing the missing master playlist.
 */
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

/**
 * Evaluates whether the master playlist and expected rendition playlists are ready.
 * @param {object} stream - Stream record containing output metadata and encoder rendition info.
 * @param {object} [options={}] - Optional overrides for output directory, renditions, and clock source.
 * @returns {object} A readiness report with file checks and a list of missing playlists.
 */
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
