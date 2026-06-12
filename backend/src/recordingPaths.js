"use strict";

const path = require("node:path");

const { appendPath } = require("./urlBuilders");

const RECORDING_ID_PATTERN = /^rec-[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;

/**
 * Validates that a recording id is safe for URL and filesystem path use.
 * @param {string} recordingId - Recording identifier to validate.
 * @returns {void}
 */
function assertRecordingId(recordingId) {
  if (typeof recordingId !== "string" || !RECORDING_ID_PATTERN.test(recordingId)) {
    throw new Error(
      "recordingId must start with rec- and use 5-164 letters, numbers, underscores, or hyphens.",
    );
  }
}

/**
 * Normalizes a path for safe comparisons across operating systems.
 * @param {string} value - The filesystem path to normalize.
 * @returns {string} Resolved path, lowercased on Windows.
 */
function normalizePathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Checks whether a candidate path lives inside a parent directory.
 * @param {string} parentDir - Expected parent directory.
 * @param {string} candidatePath - Candidate path to check.
 * @returns {boolean} True when the candidate is safely under the parent.
 */
function isPathInside(parentDir, candidatePath) {
  const normalizedParent = normalizePathForComparison(parentDir);
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  return normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

/**
 * Builds the archive directory for one recording.
 * @param {object} config - Runtime configuration containing recording roots.
 * @param {string} recordingId - Recording identifier to convert into a path.
 * @returns {string} Absolute archive directory path.
 */
function buildRecordingArchiveDir(config, recordingId) {
  assertRecordingId(recordingId);

  const archiveDir = path.resolve(config.recordings.archiveRoot, recordingId);
  if (!isPathInside(config.recordings.archiveRoot, archiveDir)) {
    throw new Error("Resolved recording archive directory must stay inside the archive root.");
  }

  return archiveDir;
}

/**
 * Builds the source MKV path for one recording archive.
 * @param {object} config - Runtime configuration containing recording roots.
 * @param {string} recordingId - Recording identifier to convert into a path.
 * @returns {string} Absolute source MKV path.
 */
function buildRecordingArchivePath(config, recordingId) {
  return path.join(buildRecordingArchiveDir(config, recordingId), "source.mkv");
}

/**
 * Builds the VOD output directory for one recording.
 * @param {object} config - Runtime configuration containing recording roots.
 * @param {string} recordingId - Recording identifier to convert into a path.
 * @returns {string} Absolute VOD output directory path.
 */
function buildRecordingVodOutputDir(config, recordingId) {
  assertRecordingId(recordingId);

  const vodOutputDir = path.resolve(config.recordings.vodRoot, recordingId);
  if (!isPathInside(config.recordings.vodRoot, vodOutputDir)) {
    throw new Error("Resolved recording VOD directory must stay inside the VOD root.");
  }

  return vodOutputDir;
}

/**
 * Builds the nginx VOD playback URL for one recording.
 * @param {object} config - Runtime configuration containing the nginx VOD base URL.
 * @param {string} recordingId - Recording identifier to convert into a URL.
 * @returns {string} Public VOD master playlist URL.
 */
function buildRecordingPlaybackUrl(config, recordingId) {
  assertRecordingId(recordingId);
  return appendPath(config.nginx.vodBaseUrl, [recordingId, "master.m3u8"]);
}

/**
 * Builds and validates the only directories a recording delete may remove.
 * @param {object} config - Runtime configuration containing recording roots.
 * @param {string} recordingId - Recording identifier to convert into cleanup targets.
 * @returns {{archiveDir: string, vodOutputDir: string}} Validated cleanup directories.
 */
function buildRecordingCleanupTargets(config, recordingId) {
  const archiveDir = buildRecordingArchiveDir(config, recordingId);
  const vodOutputDir = buildRecordingVodOutputDir(config, recordingId);

  if (!isPathInside(config.recordings.archiveRoot, archiveDir)) {
    throw new Error("Recording archive cleanup target must stay inside the archive root.");
  }

  if (!isPathInside(config.recordings.vodRoot, vodOutputDir)) {
    throw new Error("Recording VOD cleanup target must stay inside the VOD root.");
  }

  return {
    archiveDir,
    vodOutputDir,
  };
}

module.exports = {
  RECORDING_ID_PATTERN,
  assertRecordingId,
  buildRecordingArchiveDir,
  buildRecordingArchivePath,
  buildRecordingCleanupTargets,
  buildRecordingPlaybackUrl,
  buildRecordingVodOutputDir,
  isPathInside,
};
