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

module.exports = {
  buildMediaMtxPathDetailsUrl,
  buildMediaMtxPathsListUrl,
  buildMediaMtxRelayDescriptor,
};
