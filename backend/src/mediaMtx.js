"use strict";

const {
  buildMediaMtxPath,
  buildPublishUrl,
  buildWhipUrl,
} = require("./urlBuilders");

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function buildMediaMtxPathsListUrl(config) {
  return `${trimTrailingSlash(config.mediaMtx.apiBaseUrl)}/v3/paths/list`;
}

function buildMediaMtxPathDetailsUrl(config, streamId) {
  const mediaMtxPath = buildMediaMtxPath(streamId);

  return `${trimTrailingSlash(config.mediaMtx.apiBaseUrl)}/v3/paths/get/${encodeURIComponent(mediaMtxPath)}`;
}

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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
