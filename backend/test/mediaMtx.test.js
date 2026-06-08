"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const { waitForMediaMtxPathMediaFlow } = require("../src/mediaMtx");

function createTestConfig() {
  return createRuntimeConfig({
    LAN_HOST: "192.168.1.25",
    HLS_MEDIA_ROOT: "media/live",
    MEDIAMTX_API_BASE_URL: "http://127.0.0.1:9997",
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("waits until MediaMTX path has increasing inbound media bytes", async () => {
  const responses = [
    jsonResponse(404, {}),
    jsonResponse(200, {
      inboundBytes: 1000,
      ready: true,
    }),
    jsonResponse(200, {
      inboundBytes: 2600,
      ready: true,
    }),
  ];
  const calls = [];

  const status = await waitForMediaMtxPathMediaFlow(createTestConfig(), "stream-alpha", {
    fetch: async (url) => {
      calls.push(url);
      return responses.shift();
    },
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(status.ready, true);
  assert.equal(status.details.inboundBytes, 2600);
  assert.equal(calls.length, 3);
  assert.equal(calls[0], "http://127.0.0.1:9997/v3/paths/get/live%2Fstream-alpha");
});

test("does not treat a ready MediaMTX path with static inbound bytes as media flow", async () => {
  const status = await waitForMediaMtxPathMediaFlow(createTestConfig(), "stream-alpha", {
    fetch: async () => jsonResponse(200, {
      inboundBytes: 4203,
      ready: true,
    }),
    pollIntervalMs: 1,
    timeoutMs: 5,
  });

  assert.equal(status.ready, false);
  assert.equal(status.details.inboundBytes, 4203);
});
