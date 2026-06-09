"use strict";

const {
  buildMediaMtxPath,
  buildPublishUrl,
  buildWhipUrl,
} = require("./urlBuilders");

/**
 * Removes trailing slashes from a URL string so later path joining stays predictable.
 * @param {string} value - The URL string to trim.
 * @returns {string} The URL without trailing slash characters.
 */
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

/**
 * Builds the MediaMTX API URL used to list all paths.
 * @param {object} config - Runtime configuration containing MediaMTX API settings.
 * @returns {string} The fully qualified `/v3/paths/list` endpoint URL.
 */
function buildMediaMtxPathsListUrl(config) {
  return `${trimTrailingSlash(config.mediaMtx.apiBaseUrl)}/v3/paths/list`;
}

/**
 * Builds the MediaMTX API URL used to inspect one path.
 * @param {object} config - Runtime configuration containing MediaMTX API settings.
 * @param {string} streamId - Stream identifier used to derive the MediaMTX path.
 * @returns {string} The fully qualified `/v3/paths/get/...` endpoint URL.
 */
function buildMediaMtxPathDetailsUrl(config, streamId) {
  const mediaMtxPath = buildMediaMtxPath(streamId);

  return `${trimTrailingSlash(config.mediaMtx.apiBaseUrl)}/v3/paths/get/${encodeURIComponent(mediaMtxPath)}`;
}

/**
 * Builds a compact descriptor that describes how this backend talks to MediaMTX.
 * @param {object} config - Runtime configuration containing MediaMTX and HLS URLs.
 * @param {string} streamId - Stream identifier to describe.
 * @returns {object} A relay descriptor with publish URLs, whip URLs, and API inspection links.
 */
function buildMediaMtxRelayDescriptor(config, streamId) {
  const mediaMtxPath = buildMediaMtxPath(streamId);

  return {
    streamId,
    mediaMtxPath,
    publishUrl: buildPublishUrl(config, streamId),
    whipUrl: buildWhipUrl(config, streamId),
    status: {
      model: "backend-lifecycle-with-optional-mediamtx-api",
      publishReadyWhen: "stream record exists and publish URLs are issued",
      liveWhen: "publisher is connected and HLS output readiness passes",
      api: {
        pathsListUrl: buildMediaMtxPathsListUrl(config),
        pathDetailsUrl: buildMediaMtxPathDetailsUrl(config, streamId),
      },
    },
  };
}

/**
 * Waits for a given number of milliseconds before resolving.
 * @param {number} ms - Delay duration in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches MediaMTX API details for one path and returns `null` for missing paths.
 * @param {object} config - Runtime configuration containing the MediaMTX API base URL.
 * @param {string} streamId - Stream identifier to inspect.
 * @param {object} [options={}] - Optional fetch implementation and abort signal.
 * @returns {Promise<object | null>} The parsed path details, or `null` when MediaMTX returns 404.
 */
async function fetchMediaMtxPathDetails(config, streamId, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("MediaMTX path readiness requires fetch support.");
  }

  const response = await fetchImpl(buildMediaMtxPathDetailsUrl(config, streamId), {
    signal: options.signal,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`MediaMTX API returned status ${response.status}.`);
  }

  return response.json();
}

/**
 * Polls MediaMTX until a path reports ready, optionally requiring inbound traffic growth.
 * @param {object} config - Runtime configuration containing the MediaMTX API base URL.
 * @param {string} streamId - Stream identifier to wait on.
 * @param {object} [options={}] - Polling settings such as timeout and interval.
 * @returns {Promise<{details: object | null, ready: boolean}>} The final readiness result and last known details.
 */
async function waitForMediaMtxPathReady(config, streamId, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const pollIntervalMs = options.pollIntervalMs || 200;
  const requireInboundBytes = options.requireInboundBytes === true;
  const minInboundByteDelta = options.minInboundByteDelta || 1024;
  const startedAt = Date.now();
  let lastInboundBytes = null;
  let lastDetails = null;

  while (Date.now() - startedAt <= timeoutMs) {
    const details = await fetchMediaMtxPathDetails(config, streamId, options);
    lastDetails = details || lastDetails;

    if (details && details.ready === true) {
      if (!requireInboundBytes) {
        return {
          details,
          ready: true,
        };
      }

      const inboundBytes = Number(details.inboundBytes ?? details.bytesReceived ?? 0);

      if (
        Number.isFinite(inboundBytes) &&
        lastInboundBytes !== null &&
        inboundBytes - lastInboundBytes >= minInboundByteDelta
      ) {
        return {
          details,
          ready: true,
        };
      }

      if (Number.isFinite(inboundBytes)) {
        lastInboundBytes = inboundBytes;
      }
    }

    await delay(pollIntervalMs);
  }

  return {
    details: lastDetails,
    ready: false,
  };
}

/**
 * Waits for MediaMTX to report actual inbound media flow for a path.
 * @param {object} config - Runtime configuration containing the MediaMTX API base URL.
 * @param {string} streamId - Stream identifier to wait on.
 * @param {object} [options={}] - Polling settings forwarded to the shared wait helper.
 * @returns {Promise<{details: object | null, ready: boolean}>} The final readiness result and last known details.
 */
async function waitForMediaMtxPathMediaFlow(config, streamId, options = {}) {
  return waitForMediaMtxPathReady(config, streamId, {
    ...options,
    requireInboundBytes: true,
  });
}

module.exports = {
  buildMediaMtxPathDetailsUrl,
  buildMediaMtxPathsListUrl,
  buildMediaMtxRelayDescriptor,
  fetchMediaMtxPathDetails,
  waitForMediaMtxPathMediaFlow,
  waitForMediaMtxPathReady,
};
