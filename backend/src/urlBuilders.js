"use strict";

const path = require("node:path");

const STREAM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

/**
 * Validates that a stream id matches the platform's allowed character set.
 * @param {string} streamId - Stream identifier to validate.
 * @returns {void}
 */
function assertStreamId(streamId) {
  if (typeof streamId !== "string" || !STREAM_ID_PATTERN.test(streamId)) {
    throw new Error("streamId must be 1-128 characters using letters, numbers, underscores, or hyphens.");
  }
}

/**
 * Builds the MediaMTX path for a stream.
 * @param {string} streamId - Stream identifier to convert into a relay path.
 * @returns {string} The MediaMTX path in `live/<streamId>` form.
 */
function buildMediaMtxPath(streamId) {
  assertStreamId(streamId);
  return `live/${streamId}`;
}

/**
 * Appends path segments to an existing base URL while preserving protocol and host.
 * @param {string} baseUrl - Starting URL to extend.
 * @param {string[]} pathParts - Individual URL path segments to append.
 * @returns {string} The normalized URL string with the extra path segments.
 */
function appendPath(baseUrl, pathParts) {
  // Build URLs by extending an existing base URL instead of concatenating strings.
  // That keeps slashes, encoding, and host/protocol handling predictable.
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const suffix = pathParts.map((part) => encodeURIComponent(part)).join("/");
  url.pathname = `${basePath}/${suffix}`.replace(/\/+/g, "/");
  return url.toString();
}

/**
 * Builds the MediaMTX publish URL for a stream.
 * @param {object} config - Runtime configuration containing MediaMTX base URLs.
 * @param {string} streamId - Stream identifier to convert into a publish URL.
 * @returns {string} The WebRTC publish URL used by browser publishers.
 */
function buildPublishUrl(config, streamId) {
  return appendPath(config.mediaMtx.webRtcBaseUrl, ["live", streamId, "publish"]);
}

/**
 * Builds the MediaMTX WHIP URL for a stream.
 * @param {object} config - Runtime configuration containing MediaMTX base URLs.
 * @param {string} streamId - Stream identifier to convert into a WHIP URL.
 * @returns {string} The WHIP ingest URL used by custom publishers.
 */
function buildWhipUrl(config, streamId) {
  return appendPath(config.mediaMtx.webRtcBaseUrl, ["live", streamId, "whip"]);
}

/**
 * Builds the nginx playback URL for a stream's HLS master playlist.
 * @param {object} config - Runtime configuration containing the nginx HLS base URL.
 * @param {string} streamId - Stream identifier to convert into a playback URL.
 * @returns {string} The public HLS master playlist URL.
 */
function buildPlaybackUrl(config, streamId) {
  return appendPath(config.nginx.hlsBaseUrl, [streamId, "master.m3u8"]);
}

/**
 * Builds the MediaMTX WHEP playback URL for a stream.
 * @param {object} config - Runtime configuration containing MediaMTX base URLs.
 * @param {string} streamId - Stream identifier to convert into a WHEP URL.
 * @returns {string} The WebRTC playback URL used by ops viewers.
 */
function buildWhepPlaybackUrl(config, streamId) {
  return appendPath(config.mediaMtx.webRtcBaseUrl, ["live", streamId, "whep"]);
}

/**
 * Builds the on-disk HLS output directory for one stream.
 * @param {object} config - Runtime configuration containing the media root path.
 * @param {string} streamId - Stream identifier to convert into a filesystem path.
 * @returns {string} The absolute output directory path for the stream.
 */
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

/**
 * Collects every URL and path the backend needs for one stream in one object.
 * @param {object} config - Runtime configuration containing relay and playback base URLs.
 * @param {string} streamId - Stream identifier to describe.
 * @returns {object} A bundle of publish, playback, and filesystem locations for the stream.
 */
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
  buildWhepPlaybackUrl,
};
