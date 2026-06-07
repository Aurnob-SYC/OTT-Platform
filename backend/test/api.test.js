"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const { createServer } = require("../src/index");
const { createStreamStore } = require("../src/streams");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function requestJson(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json",
    };

    if (requestBody !== undefined) {
      headers["Content-Length"] = Buffer.byteLength(requestBody);
    }

    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers,
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode,
              headers: response.headers,
              body: JSON.parse(responseBody),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`${method} ${pathname} timed out.`));
    });

    if (requestBody !== undefined) {
      request.write(requestBody);
    }

    request.end();
  });
}

function createTestConfig() {
  return createRuntimeConfig(
    {
      LAN_HOST: "192.168.1.25",
      HLS_MEDIA_ROOT: "media/live",
    },
    {
      backendRoot: path.join(os.tmpdir(), "ott-stream-api-test"),
    },
  );
}

function createFakeEncoderManager() {
  const started = new Map();

  return {
    getEncoderStatus(streamId) {
      return started.get(streamId) || null;
    },
    startEncoder(stream, options) {
      const status = {
        commandLine: `ffmpeg -i rtsp://127.0.0.1:8554/live/${stream.streamId}`,
        exitCode: null,
        exitSignal: null,
        inputUrl: `rtsp://127.0.0.1:8554/live/${stream.streamId}`,
        outputDir: stream.output.hlsOutputDir,
        pid: 4321,
        renditions: options.renditions,
        running: true,
        startedAt: "2026-01-01T00:00:00.000Z",
        stderrTail: "",
      };

      started.set(stream.streamId, status);
      return status;
    },
    stopEncoder(streamId) {
      started.delete(streamId);
      return {
        exitCode: 0,
        exitSignal: "SIGTERM",
        state: "stopped",
        stderrTail: "",
        stoppedAt: "2026-01-01T00:00:01.000Z",
      };
    },
  };
}

test("exposes stream creation, publishing, encoder metadata, status, listing, and stop APIs", async () => {
  const config = createTestConfig();
  const server = createServer(config, {
    streamApiOptions: {
      encoderManager: createFakeEncoderManager(),
      streamStoreOptions: {
        idGenerator: () => "stream-alpha",
      },
    },
  });
  const address = await listen(server);

  try {
    const created = await requestJson(address.port, "POST", "/api/streams", {
      title: "Desk cam",
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.body.streamId, "stream-alpha");
    assert.equal(created.body.publishPath, "live/stream-alpha");
    assert.equal(created.body.stream.state, "created");

    const prematureEncoder = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/encoder/start",
      {},
    );

    assert.equal(prematureEncoder.statusCode, 409);
    assert.equal(prematureEncoder.body.error, "ENCODER_START_NOT_ALLOWED");

    const publishing = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/publish/start",
      {
        userId: "user-123",
      },
    );

    assert.equal(publishing.statusCode, 200);
    assert.equal(publishing.body.success, true);
    assert.equal(
      publishing.body.publishUrl,
      "http://192.168.1.25:8889/live/stream-alpha/publish",
    );
    assert.equal(publishing.body.whipUrl, "http://192.168.1.25:8889/live/stream-alpha/whip");
    assert.equal(publishing.body.stream.publisher.userId, "user-123");

    const encoding = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/encoder/start",
      {
        renditions: ["360p", "480p"],
      },
    );

    assert.equal(encoding.statusCode, 200);
    assert.equal(encoding.body.success, true);
    assert.equal(encoding.body.pid, 4321);
    assert.deepEqual(encoding.body.renditions, ["360p", "480p"]);
    assert.equal(encoding.body.stream.state, "encoding");
    assert.equal(encoding.body.stream.encoder.inputUrl, "rtsp://127.0.0.1:8554/live/stream-alpha");
    assert.equal(encoding.body.stream.encoder.commandLine.includes("ffmpeg"), true);

    const status = await requestJson(
      address.port,
      "GET",
      "/api/streams/stream-alpha/status",
    );

    assert.equal(status.statusCode, 200);
    assert.equal(status.body.streamId, "stream-alpha");
    assert.equal(status.body.output.playbackUrl, "http://192.168.1.25/hls/stream-alpha/master.m3u8");

    const listActive = await requestJson(address.port, "GET", "/api/streams");

    assert.equal(listActive.statusCode, 200);
    assert.deepEqual(listActive.body.active.map((stream) => stream.streamId), ["stream-alpha"]);
    assert.deepEqual(listActive.body.recent, []);
    assert.equal(listActive.body.streams.length, 1);

    const stopped = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/stop",
      {},
    );

    assert.equal(stopped.statusCode, 200);
    assert.equal(stopped.body.success, true);
    assert.equal(stopped.body.stream.state, "stopped");
    assert.equal(stopped.body.stream.encoder.exitSignal, "SIGTERM");

    const listRecent = await requestJson(address.port, "GET", "/api/streams");

    assert.deepEqual(listRecent.body.active, []);
    assert.deepEqual(listRecent.body.recent.map((stream) => stream.streamId), ["stream-alpha"]);

    const publishAfterStop = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/publish/start",
      {
        userId: "user-123",
      },
    );

    assert.equal(publishAfterStop.statusCode, 409);
    assert.equal(publishAfterStop.body.error, "STREAM_PUBLISH_NOT_ALLOWED");
  } finally {
    await close(server);
  }
});

test("returns useful JSON errors for invalid stream IDs and missing streams", async () => {
  const server = createServer(createTestConfig());
  const address = await listen(server);

  try {
    const invalidId = await requestJson(address.port, "GET", "/api/streams/bad!/status");
    assert.equal(invalidId.statusCode, 400);
    assert.equal(invalidId.body.error, "INVALID_STREAM_ID");

    const missing = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-missing/publish/start",
      {},
    );
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error, "STREAM_NOT_FOUND");
  } finally {
    await close(server);
  }
});

test("starts, replaces, and clears one active stream per viewer session", async () => {
  const config = createTestConfig();
  const streamStore = createStreamStore(config);

  streamStore.createStream({ streamId: "stream-alpha", title: "Alpha" });
  streamStore.createStream({ streamId: "stream-beta", title: "Beta" });
  streamStore.createStream({ streamId: "stream-waiting", title: "Waiting" });
  streamStore.markLive("stream-alpha");
  streamStore.markLive("stream-beta");

  const server = createServer(config, {
    streamApiOptions: {
      streamStore,
    },
  });
  const address = await listen(server);

  try {
    const first = await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-1",
      streamId: "stream-alpha",
    });

    assert.equal(first.statusCode, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.previousStreamId, null);
    assert.equal(first.body.playbackUrl, "http://192.168.1.25/hls/stream-alpha/master.m3u8");

    const replaced = await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-1",
      streamId: "stream-beta",
    });

    assert.equal(replaced.statusCode, 200);
    assert.equal(replaced.body.previousStreamId, "stream-alpha");
    assert.equal(replaced.body.session.streamId, "stream-beta");

    const notPlayable = await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-2",
      streamId: "stream-waiting",
    });

    assert.equal(notPlayable.statusCode, 409);
    assert.equal(notPlayable.body.error, "STREAM_NOT_PLAYABLE");

    const cleared = await requestJson(address.port, "DELETE", "/api/viewer/session", {
      viewerId: "viewer-1",
    });

    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.body.success, true);
    assert.equal(cleared.body.stoppedStreamId, "stream-beta");
  } finally {
    await close(server);
  }
});
