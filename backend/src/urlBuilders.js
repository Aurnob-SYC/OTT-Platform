"use strict";

const path = require("node:path");

const STREAM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function assertStreamId(streamId) {
  if (typeof streamId !== "string" || !STREAM_ID_PATTERN.test(streamId)) {
    throw new Error("streamId must be 1-128 characters using letters, numbers, underscores, or hyphens.");
  }
}

function buildMediaMtxPath(streamId) {
  assertStreamId(streamId);
  return `live/${streamId}`;
}

function appendPath(baseUrl, pathParts) {
  // Build URLs by extending an existing base URL instead of concatenating strings.
  // That keeps slashes, encoding, and host/protocol handling predictable.
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const suffix = pathParts.map((part) => encodeURIComponent(part)).join("/");
  url.pathname = `${basePath}/${suffix}`.replace(/\/+/g, "/");
  return url.toString();
}

function buildPublishUrl(config, streamId) {
  return appendPath(config.mediaMtx.webRtcBaseUrl, ["live", streamId, "publish"]);
}

function buildWhipUrl(config, streamId) {
  return appendPath(config.mediaMtx.webRtcBaseUrl, ["live", streamId, "whip"]);
}

function buildPlaybackUrl(config, streamId) {
  return appendPath(config.nginx.hlsBaseUrl, [streamId, "master.m3u8"]);
}

function buildStreamHlsOutputDir(config, streamId) {
  assertStreamId(streamId);

  // Each stream gets its own folder under the shared HLS root.
  // The prefix check below prevents path traversal outside that root.
  const outputDir = path.resolve(config.hls.mediaRoot, streamId);
  const mediaRootWithSeparator = `${path.resolve(config.hls.mediaRoot)}${path.sep}`;

  if (!outputDir.startsWith(mediaRootWithSeparator)) {
    throw new Error("Resolved HLS output directory must stay inside the media root.");
  }

  return outputDir;
}

function buildStreamUrls(config, streamId) {
  // Collect every URL/path the rest of the backend needs for one stream in one place.
  return {
    streamId,
    publishPath: buildMediaMtxPath(streamId),
    publishUrl: buildPublishUrl(config, streamId),
    whipUrl: buildWhipUrl(config, streamId),
    playbackUrl: buildPlaybackUrl(config, streamId),
    hlsOutputDir: buildStreamHlsOutputDir(config, streamId),
  };
}

module.exports = {
  STREAM_ID_PATTERN,
  assertStreamId,
  buildMediaMtxPath,
  buildPlaybackUrl,
  buildPublishUrl,
  buildStreamHlsOutputDir,
  buildStreamUrls,
  buildWhipUrl,
};
