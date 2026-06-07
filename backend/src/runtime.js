"use strict";

const fs = require("node:fs");
const path = require("node:path");

function assertRequiredConfig(config) {
  const missing = [];

  if (!config.lanHost) missing.push("LAN_HOST");
  if (!config.backend.baseUrl) missing.push("BACKEND_BASE_URL");
  if (!config.mediaMtx.webRtcBaseUrl) missing.push("MEDIAMTX_WEBRTC_BASE_URL");
  if (!config.mediaMtx.apiBaseUrl) missing.push("MEDIAMTX_API_BASE_URL");
  if (!config.mediaMtx.rtspBaseUrl) missing.push("MEDIAMTX_RTSP_BASE_URL");
  if (!config.nginx.hlsBaseUrl) missing.push("NGINX_HLS_BASE_URL");
  if (!config.hls.mediaRoot) missing.push("HLS_MEDIA_ROOT");

  if (missing.length > 0) {
    throw new Error(`Missing required runtime configuration: ${missing.join(", ")}`);
  }
}

function ensureDirectory(directoryPath) {
  // Create the directory if it does not exist, then verify it really is a directory.
  fs.mkdirSync(directoryPath, { recursive: true });

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new Error(`${directoryPath} exists but is not a directory.`);
  }
}

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

function validateRuntime(config) {
  // Startup-time validation is where we fail fast on missing config or an unsafe HLS root.
  assertRequiredConfig(config);
  ensureDirectory(config.hls.mediaRoot);

  if (config.hls.cleanStaleOutputOnStart) {
    cleanStaleHlsOutput(config.hls.mediaRoot);
  }

  return {
    mediaRoot: path.resolve(config.hls.mediaRoot),
    cleanedStaleOutput: config.hls.cleanStaleOutputOnStart,
  };
}

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
    },
    hls: {
      mediaRoot: path.resolve(config.hls.mediaRoot),
      cleanStaleOutputOnStart: config.hls.cleanStaleOutputOnStart,
    },
    externalBinaries: config.externalBinaries,
  };
}

module.exports = {
  cleanStaleHlsOutput,
  getRuntimeSummary,
  validateRuntime,
};
