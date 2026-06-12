"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Verifies that required runtime config values are present before the backend starts.
 * @param {object} config - Runtime configuration object created by `createRuntimeConfig`.
 * @returns {void}
 */
function assertRequiredConfig(config) {
  const missing = [];

  if (!config.lanHost) missing.push("LAN_HOST");
  if (!config.backend.baseUrl) missing.push("BACKEND_BASE_URL");
  if (!config.mediaMtx.webRtcBaseUrl) missing.push("MEDIAMTX_WEBRTC_BASE_URL");
  if (!config.mediaMtx.apiBaseUrl) missing.push("MEDIAMTX_API_BASE_URL");
  if (!config.mediaMtx.rtspBaseUrl) missing.push("MEDIAMTX_RTSP_BASE_URL");
  if (!config.nginx.hlsBaseUrl) missing.push("NGINX_HLS_BASE_URL");
  if (!config.nginx.vodBaseUrl) missing.push("NGINX_VOD_BASE_URL");
  if (!config.hls.mediaRoot) missing.push("HLS_MEDIA_ROOT");
  if (!config.recordings.archiveRoot) missing.push("RECORDING_ARCHIVE_ROOT");
  if (!config.recordings.vodRoot) missing.push("VOD_MEDIA_ROOT");
  if (!config.recordings.metadataPath) missing.push("RECORDING_METADATA_FILE");

  if (missing.length > 0) {
    throw new Error(`Missing required runtime configuration: ${missing.join(", ")}`);
  }
}

/**
 * Ensures a filesystem path exists and is actually a directory.
 * @param {string} directoryPath - Path to create and validate.
 * @returns {void}
 */
function ensureDirectory(directoryPath) {
  // Create the directory if it does not exist, then verify it really is a directory.
  fs.mkdirSync(directoryPath, { recursive: true });

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new Error(`${directoryPath} exists but is not a directory.`);
  }
}

/**
 * Deletes existing HLS output entries so a backend restart can start cleanly.
 * @param {string} mediaRoot - Absolute or relative HLS media root directory.
 * @returns {void}
 */
function cleanStaleHlsOutput(mediaRoot) {
  const absoluteMediaRoot = path.resolve(mediaRoot);

  // Remove any old stream folders/files so a fresh backend start does not reuse stale output.
  for (const entry of fs.readdirSync(absoluteMediaRoot, { withFileTypes: true })) {
    const targetPath = path.resolve(absoluteMediaRoot, entry.name);
    const mediaRootWithSeparator = `${absoluteMediaRoot}${path.sep}`;

    if (!targetPath.startsWith(mediaRootWithSeparator)) {
      throw new Error(`Refusing to clean path outside media root: ${targetPath}`);
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

/**
 * Validates the runtime layout and optionally removes stale HLS output.
 * @param {object} config - Runtime configuration object.
 * @returns {{mediaRoot: string, cleanedStaleOutput: boolean}} Validation summary for startup logging.
 */
function validateRuntime(config) {
  // Startup-time validation is where we fail fast on missing config or an unsafe HLS root.
  assertRequiredConfig(config);
  ensureDirectory(config.hls.mediaRoot);
  ensureDirectory(config.recordings.archiveRoot);
  ensureDirectory(config.recordings.vodRoot);

  if (config.hls.cleanStaleOutputOnStart) {
    cleanStaleHlsOutput(config.hls.mediaRoot);
  }

  return {
    mediaRoot: path.resolve(config.hls.mediaRoot),
    archiveRoot: path.resolve(config.recordings.archiveRoot),
    vodRoot: path.resolve(config.recordings.vodRoot),
    cleanedStaleOutput: config.hls.cleanStaleOutputOnStart,
  };
}

/**
 * Produces the small runtime summary exposed by the backend status endpoint.
 * @param {object} config - Runtime configuration object.
 * @returns {object} A safe-to-expose summary of URLs, ports, HLS settings, and binaries.
 */
function getRuntimeSummary(config) {
  // This is the small, safe slice of config we expose through the status endpoint.
  return {
    lanHost: config.lanHost,
    ports: config.ports,
    urls: {
      frontend: config.frontend.baseUrl,
      backendApi: config.backend.baseUrl,
      mediaMtxWebRtc: config.mediaMtx.webRtcBaseUrl,
      mediaMtxApi: config.mediaMtx.apiBaseUrl,
      mediaMtxRtsp: config.mediaMtx.rtspBaseUrl,
      nginxHls: config.nginx.hlsBaseUrl,
      nginxVod: config.nginx.vodBaseUrl,
    },
    hls: {
      mediaRoot: path.resolve(config.hls.mediaRoot),
      cleanStaleOutputOnStart: config.hls.cleanStaleOutputOnStart,
    },
    recordings: {
      archiveRoot: path.resolve(config.recordings.archiveRoot),
      vodRoot: path.resolve(config.recordings.vodRoot),
      metadataPath: path.resolve(config.recordings.metadataPath),
    },
    externalBinaries: config.externalBinaries,
  };
}

module.exports = {
  cleanStaleHlsOutput,
  getRuntimeSummary,
  validateRuntime,
};
