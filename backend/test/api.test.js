"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
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
      backendRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ott-stream-api-test-")),
    },
  );
}

function createFakeEncoderManager() {
  const started = new Map();

  return {
    getEncoderStatus(streamId) {
      return started.get(streamId) || null;
    },
    listEncoderWorkers() {
      return Array.from(started.values());
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

function createFakeSpawn(calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 7000 + calls.length;
    child.kill = (signal) => {
      child.killedSignal = signal;
      return true;
    };

    calls.push({
      args,
      child,
      command,
      options,
    });

    return child;
  };
}

function writeReadyHlsOutput(stream, renditions = ["360p", "480p", "720p"]) {
  fs.mkdirSync(stream.output.hlsOutputDir, { recursive: true });
  fs.writeFileSync(path.join(stream.output.hlsOutputDir, "master.m3u8"), "#EXTM3U\n");

  for (const rendition of renditions) {
    const renditionDir = path.join(stream.output.hlsOutputDir, rendition);
    fs.mkdirSync(renditionDir, { recursive: true });
    fs.writeFileSync(path.join(renditionDir, "index.m3u8"), "#EXTM3U\n");
  }
}

test("exposes stream creation, publishing, encoder metadata, status, listing, and stop APIs", async () => {
  const config = createTestConfig();
  const lifecycleLogs = [];
  const server = createServer(config, {
    streamApiOptions: {
      encoderManager: createFakeEncoderManager(),
      logger: (entry) => lifecycleLogs.push(entry),
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
    assert.equal(lifecycleLogs.at(-1).event, "stream_created");
    assert.equal(lifecycleLogs.at(-1).stream.streamId, "stream-alpha");

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
    assert.equal(lifecycleLogs.at(-1).event, "publish_started");
    assert.equal(lifecycleLogs.at(-1).stream.mediaMtxPath, "live/stream-alpha");

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
    assert.equal(encoding.body.stream.encoder.running, true);
    assert.equal(encoding.body.stream.output.readiness.ready, false);
    assert.deepEqual(encoding.body.stream.output.readiness.missing, [
      "master.m3u8",
      "360p/index.m3u8",
      "480p/index.m3u8",
    ]);
    assert.equal(lifecycleLogs.at(-1).event, "encoder_started");
    assert.equal(lifecycleLogs.at(-1).stream.encoder.pid, 4321);

    const operatorWhileEncoding = await requestJson(
      address.port,
      "GET",
      "/api/operator/status",
    );

    assert.equal(operatorWhileEncoding.statusCode, 200);
    assert.equal(operatorWhileEncoding.body.ok, true);
    assert.equal(operatorWhileEncoding.body.operator.counts.activeStreams, 1);
    assert.equal(operatorWhileEncoding.body.operator.counts.encoderWorkers, 1);
    assert.equal(
      operatorWhileEncoding.body.operator.activeStreams[0].mediaMtxPath,
      "live/stream-alpha",
    );
    assert.equal(operatorWhileEncoding.body.operator.activeStreams[0].encoder.pid, 4321);
    assert.equal(operatorWhileEncoding.body.operator.encoderWorkers[0].pid, 4321);

    const prematureViewer = await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-warming",
      streamId: "stream-alpha",
    });

    assert.equal(prematureViewer.statusCode, 409);
    assert.equal(prematureViewer.body.error, "STREAM_NOT_PLAYABLE");

    const status = await requestJson(
      address.port,
      "GET",
      "/api/streams/stream-alpha/status",
    );

    assert.equal(status.statusCode, 200);
    assert.equal(status.body.streamId, "stream-alpha");
    assert.equal(status.body.state, "encoding");
    assert.equal(status.body.output.playbackUrl, "http://192.168.1.25/hls/stream-alpha/master.m3u8");

    writeReadyHlsOutput(status.body, ["360p", "480p"]);

    const readyStatus = await requestJson(
      address.port,
      "GET",
      "/api/streams/stream-alpha/status",
    );

    assert.equal(readyStatus.statusCode, 200);
    assert.equal(readyStatus.body.state, "live");
    assert.equal(readyStatus.body.output.readiness.ready, true);
    assert.deepEqual(readyStatus.body.output.readiness.missing, []);
    assert.equal(lifecycleLogs.at(-1).event, "hls_ready");
    assert.equal(lifecycleLogs.at(-1).stream.outputReady, true);

    const listActive = await requestJson(address.port, "GET", "/api/streams");

    assert.equal(listActive.statusCode, 200);
    assert.deepEqual(listActive.body.active.map((stream) => stream.streamId), ["stream-alpha"]);
    assert.equal(listActive.body.active[0].state, "live");
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
    assert.equal(stopped.body.stream.encoder.running, false);
    assert.equal(lifecycleLogs.at(-1).event, "stream_stopped");
    assert.equal(lifecycleLogs.at(-1).stream.streamId, "stream-alpha");

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

test("waits for MediaMTX relay readiness before requested encoder start", async () => {
  const config = createTestConfig();
  const waitedStreamIds = [];
  const server = createServer(config, {
    streamApiOptions: {
      encoderManager: createFakeEncoderManager(),
      mediaMtxPathWaiter: async (_config, streamId) => {
        waitedStreamIds.push(streamId);
        return {
          details: {
            name: `live/${streamId}`,
            ready: true,
          },
          ready: true,
        };
      },
      streamStoreOptions: {
        idGenerator: () => "stream-alpha",
      },
    },
  });
  const address = await listen(server);

  try {
    await requestJson(address.port, "POST", "/api/streams", {
      title: "Desk cam",
    });
    await requestJson(address.port, "POST", "/api/streams/stream-alpha/publish/start", {});

    const encoding = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/encoder/start",
      {
        waitForRelayReady: true,
      },
    );

    assert.equal(encoding.statusCode, 200);
    assert.equal(encoding.body.stream.state, "encoding");
    assert.deepEqual(waitedStreamIds, ["stream-alpha"]);
  } finally {
    await close(server);
  }
});

test("rejects requested encoder start when MediaMTX relay media is not flowing", async () => {
  const config = createTestConfig();
  const server = createServer(config, {
    streamApiOptions: {
      encoderManager: createFakeEncoderManager(),
      mediaMtxPathWaiter: async () => ({
        details: null,
        ready: false,
      }),
      streamStoreOptions: {
        idGenerator: () => "stream-alpha",
      },
    },
  });
  const address = await listen(server);

  try {
    await requestJson(address.port, "POST", "/api/streams", {
      title: "Desk cam",
    });
    await requestJson(address.port, "POST", "/api/streams/stream-alpha/publish/start", {});

    const encoding = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/encoder/start",
      {
        waitForRelayReady: true,
      },
    );

    assert.equal(encoding.statusCode, 409);
    assert.equal(encoding.body.error, "MEDIAMTX_MEDIA_NOT_FLOWING");
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

test("marks only the crashed encoder stream failed and cleans only its HLS output", async () => {
  const config = createTestConfig();
  const calls = [];
  const lifecycleLogs = [];
  const ids = ["stream-alpha", "stream-beta"];
  const server = createServer(config, {
    streamApiOptions: {
      logger: (entry) => lifecycleLogs.push(entry),
      encoderManagerOptions: {
        spawn: createFakeSpawn(calls),
        now: (() => {
          let tick = 0;
          return () => {
            tick += 1;
            return new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
          };
        })(),
      },
      streamStoreOptions: {
        idGenerator: () => ids.shift(),
      },
    },
  });
  const address = await listen(server);

  try {
    const createdAlpha = await requestJson(address.port, "POST", "/api/streams", {
      title: "Alpha",
    });
    const createdBeta = await requestJson(address.port, "POST", "/api/streams", {
      title: "Beta",
    });

    await requestJson(address.port, "POST", "/api/streams/stream-alpha/publish/start", {});
    await requestJson(address.port, "POST", "/api/streams/stream-beta/publish/start", {});
    await requestJson(address.port, "POST", "/api/streams/stream-alpha/encoder/start", {});
    await requestJson(address.port, "POST", "/api/streams/stream-beta/encoder/start", {});

    assert.equal(calls.length, 2);
    assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-alpha", "master.m3u8")), true);
    assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-beta", "master.m3u8")), true);

    calls[0].child.stderr.emit("data", Buffer.from("ffmpeg could not read input"));
    calls[0].child.emit("close", 1, null);

    const alphaStatus = await requestJson(
      address.port,
      "GET",
      "/api/streams/stream-alpha/status",
    );
    const betaStatus = await requestJson(
      address.port,
      "GET",
      "/api/streams/stream-beta/status",
    );

    assert.equal(createdAlpha.body.streamId, "stream-alpha");
    assert.equal(createdBeta.body.streamId, "stream-beta");
    assert.equal(alphaStatus.body.state, "failed");
    assert.equal(alphaStatus.body.encoder.exitCode, 1);
    assert.equal(alphaStatus.body.encoder.stderrTail, "ffmpeg could not read input");
    assert.equal(alphaStatus.body.error.code, "ENCODER_EXITED");
    assert.equal(alphaStatus.body.error.cleanup.attempted, true);
    assert.equal(betaStatus.body.state, "encoding");
    assert.equal(betaStatus.body.encoder.pid, 7001);
    assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-alpha", "master.m3u8")), false);
    assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-beta", "master.m3u8")), true);
    assert.equal(calls.length, 2);
    assert.equal(lifecycleLogs.at(-1).event, "encoder_failed");
    assert.equal(lifecycleLogs.at(-1).stream.streamId, "stream-alpha");
    assert.equal(lifecycleLogs.at(-1).stream.error.code, "ENCODER_EXITED");

    const restartedAlpha = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-alpha/encoder/start",
      {
        renditions: ["360p"],
      },
    );

    assert.equal(restartedAlpha.statusCode, 200);
    assert.equal(restartedAlpha.body.stream.state, "encoding");
    assert.equal(restartedAlpha.body.stream.error, null);
    assert.equal(restartedAlpha.body.pid, 7002);
    assert.equal(calls.length, 3);
    assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-alpha", "master.m3u8")), true);
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
  const alpha = streamStore.markEncoding("stream-alpha", {
    encoder: {
      renditions: ["360p"],
    },
  });
  const beta = streamStore.markEncoding("stream-beta", {
    encoder: {
      renditions: ["360p"],
    },
  });

  writeReadyHlsOutput(alpha, ["360p"]);
  writeReadyHlsOutput(beta, ["360p"]);

  const server = createServer(config, {
    streamApiOptions: {
      logger: () => {},
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

    const reportedFirst = await requestJson(
      address.port,
      "GET",
      "/api/viewer/session?viewerId=viewer-1",
    );

    assert.equal(reportedFirst.statusCode, 200);
    assert.equal(reportedFirst.body.success, true);
    assert.equal(reportedFirst.body.streamId, "stream-alpha");
    assert.equal(
      reportedFirst.body.playbackUrl,
      "http://192.168.1.25/hls/stream-alpha/master.m3u8",
    );

    const replaced = await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-1",
      streamId: "stream-beta",
    });

    assert.equal(replaced.statusCode, 200);
    assert.equal(replaced.body.previousStreamId, "stream-alpha");
    assert.equal(replaced.body.session.streamId, "stream-beta");

    const reportedReplaced = await requestJson(
      address.port,
      "GET",
      "/api/viewer/session?viewerId=viewer-1",
    );

    assert.equal(reportedReplaced.statusCode, 200);
    assert.equal(reportedReplaced.body.streamId, "stream-beta");
    assert.equal(
      reportedReplaced.body.playbackUrl,
      "http://192.168.1.25/hls/stream-beta/master.m3u8",
    );

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

    const reportedCleared = await requestJson(
      address.port,
      "GET",
      "/api/viewer/session?viewerId=viewer-1",
    );

    assert.equal(reportedCleared.statusCode, 200);
    assert.equal(reportedCleared.body.streamId, null);
    assert.equal(reportedCleared.body.playbackUrl, null);
    assert.equal(reportedCleared.body.session, null);

    await requestJson(address.port, "POST", "/api/viewer/session", {
      viewerId: "viewer-2",
      streamId: "stream-beta",
    });

    const stoppedStream = await requestJson(
      address.port,
      "POST",
      "/api/streams/stream-beta/stop",
      {},
    );

    assert.equal(stoppedStream.statusCode, 200);
    assert.equal(stoppedStream.body.clearedViewerSessions, 1);

    const reportedAfterStreamStop = await requestJson(
      address.port,
      "GET",
      "/api/viewer/session?viewerId=viewer-2",
    );

    assert.equal(reportedAfterStreamStop.statusCode, 200);
    assert.equal(reportedAfterStreamStop.body.streamId, null);
  } finally {
    await close(server);
  }
});
