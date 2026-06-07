"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const { parseEnvFile } = require("../src/env");
const {
  buildMediaMtxPathDetailsUrl,
  buildMediaMtxPathsListUrl,
  buildMediaMtxRelayDescriptor,
} = require("../src/mediaMtx");
const { validateRuntime } = require("../src/runtime");
const {
  buildMediaMtxPath,
  buildPlaybackUrl,
  buildPublishUrl,
  buildStreamHlsOutputDir,
  buildWhipUrl,
} = require("../src/urlBuilders");

test("creates LAN runtime defaults and stream URLs", () => {
  const config = createRuntimeConfig(
    {
      LAN_HOST: "192.168.1.25",
    },
    {
      backendRoot: "D:\\OTT-Platform\\backend",
    },
  );

  assert.equal(config.backend.port, 4000);
  assert.equal(config.mediaMtx.webRtcBaseUrl, "http://192.168.1.25:8889");
  assert.equal(config.nginx.hlsBaseUrl, "http://192.168.1.25/hls");
  assert.equal(buildMediaMtxPath("stream-abc"), "live/stream-abc");
  assert.equal(buildPublishUrl(config, "stream-abc"), "http://192.168.1.25:8889/live/stream-abc/publish");
  assert.equal(buildWhipUrl(config, "stream-abc"), "http://192.168.1.25:8889/live/stream-abc/whip");
  assert.equal(buildPlaybackUrl(config, "stream-abc"), "http://192.168.1.25/hls/stream-abc/master.m3u8");
});

test("rejects invalid port configuration clearly", () => {
  assert.throws(
    () => createRuntimeConfig({ BACKEND_PORT: "70000" }),
    /BACKEND_PORT must be an integer port between 1 and 65535/,
  );
});

test("keeps per-stream HLS output inside the configured media root", () => {
  const config = createRuntimeConfig(
    {
      HLS_MEDIA_ROOT: "media/live",
    },
    {
      backendRoot: path.join(os.tmpdir(), "ott-backend-test"),
    },
  );

  assert.match(buildStreamHlsOutputDir(config, "stream_ok-1"), /stream_ok-1$/);
  assert.throws(() => buildStreamHlsOutputDir(config, "../escape"), /streamId must be/);
});

test("builds MediaMTX relay URLs and status API references for one path", () => {
  const config = createRuntimeConfig({
    LAN_HOST: "192.168.1.25",
    MEDIAMTX_API_BASE_URL: "http://192.168.1.25:9997/",
  });

  const relay = buildMediaMtxRelayDescriptor(config, "stream-abc");

  assert.equal(relay.mediaMtxPath, "live/stream-abc");
  assert.equal(relay.publishUrl, "http://192.168.1.25:8889/live/stream-abc/publish");
  assert.equal(relay.whipUrl, "http://192.168.1.25:8889/live/stream-abc/whip");
  assert.equal(relay.status.model, "backend-lifecycle-with-optional-mediamtx-api");
  assert.equal(buildMediaMtxPathsListUrl(config), "http://192.168.1.25:9997/v3/paths/list");
  assert.equal(
    buildMediaMtxPathDetailsUrl(config, "stream-abc"),
    "http://192.168.1.25:9997/v3/paths/get/live%2Fstream-abc",
  );
});

test("runtime validation creates the HLS media root and can clean stale output when enabled", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ott-runtime-"));
  const staleDir = path.join(tempRoot, "media", "live", "old-stream");
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, "master.m3u8"), "#EXTM3U");

  const config = createRuntimeConfig(
    {
      HLS_MEDIA_ROOT: "media/live",
      HLS_CLEAN_STALE_OUTPUT_ON_START: "true",
    },
    {
      backendRoot: tempRoot,
    },
  );

  const result = validateRuntime(config);

  assert.equal(result.cleanedStaleOutput, true);
  assert.equal(fs.existsSync(config.hls.mediaRoot), true);
  assert.equal(fs.existsSync(staleDir), false);
});

test("parses local env files without overwriting shell-specific behavior", () => {
  const values = parseEnvFile(`
    LAN_HOST=192.168.1.20
    BACKEND_PORT=4100 # local override
    QUOTED_URL="http://192.168.1.20/hls"
    # ignored comment
  `);

  assert.deepEqual(values, {
    LAN_HOST: "192.168.1.20",
    BACKEND_PORT: "4100",
    QUOTED_URL: "http://192.168.1.20/hls",
  });
});
