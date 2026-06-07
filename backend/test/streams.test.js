"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const {
  STREAM_STATES,
  createStreamStore,
  generateStreamId,
} = require("../src/streams");

function createTestConfig() {
  return createRuntimeConfig(
    {
      LAN_HOST: "192.168.1.25",
      HLS_MEDIA_ROOT: "media/live",
    },
    {
      backendRoot: path.join(os.tmpdir(), "ott-stream-store-test"),
    },
  );
}

function createClock() {
  let tick = 0;

  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  };
}

test("creates independent stream records with per-stream relay and HLS paths", () => {
  const config = createTestConfig();
  const store = createStreamStore(config, {
    idGenerator: (() => {
      const ids = ["stream-alpha", "stream-beta"];
      return () => ids.shift();
    })(),
    now: createClock(),
  });

  const first = store.createStream({
    title: "Desk cam",
    publisherUserId: "user-1",
  });
  const second = store.createStream({
    title: "Window cam",
    publisherUserId: "user-2",
  });

  assert.equal(first.streamId, "stream-alpha");
  assert.equal(first.state, STREAM_STATES.CREATED);
  assert.equal(first.publisher.userId, "user-1");
  assert.equal(first.relay.mediaMtxPath, "live/stream-alpha");
  assert.equal(first.relay.publishUrl, "http://192.168.1.25:8889/live/stream-alpha/publish");
  assert.equal(first.relay.whipUrl, "http://192.168.1.25:8889/live/stream-alpha/whip");
  assert.equal(first.output.playbackUrl, "http://192.168.1.25/hls/stream-alpha/master.m3u8");
  assert.match(first.output.hlsOutputDir, /stream-alpha$/);

  assert.equal(second.streamId, "stream-beta");
  assert.equal(second.relay.mediaMtxPath, "live/stream-beta");
  assert.notEqual(first.output.hlsOutputDir, second.output.hlsOutputDir);
  assert.deepEqual(store.listStreams().active.map((stream) => stream.streamId), [
    "stream-beta",
    "stream-alpha",
  ]);
});

test("rejects invalid and duplicate stream IDs", () => {
  const config = createTestConfig();
  const store = createStreamStore(config);

  assert.throws(() => store.createStream({ streamId: "../escape" }), /streamId must be/);

  store.createStream({ streamId: "stream-fixed" });
  assert.throws(
    () => store.createStream({ streamId: "stream-fixed" }),
    /Stream already exists: stream-fixed/,
  );
});

test("generated stream IDs are valid for backend URL and path builders", () => {
  const generatedId = generateStreamId();

  assert.match(generatedId, /^stream-[0-9a-f]{24}$/);
});

test("represents stopped and failed streams without changing unrelated records", () => {
  const config = createTestConfig();
  const store = createStreamStore(config, { now: createClock() });

  store.createStream({ streamId: "stream-good", title: "Good stream" });
  store.createStream({ streamId: "stream-failed", title: "Failed stream" });

  const good = store.markLive("stream-good");
  const failed = store.markFailed("stream-failed", {
    encoder: {
      pid: 1234,
      exitCode: 1,
      stderrTail: "ffmpeg could not read input",
    },
    error: {
      code: "ENCODER_EXITED",
      message: "FFmpeg exited with code 1.",
    },
  });

  assert.equal(good.state, STREAM_STATES.LIVE);
  assert.equal(failed.state, STREAM_STATES.FAILED);
  assert.equal(failed.encoder.pid, 1234);
  assert.equal(failed.encoder.exitCode, 1);
  assert.equal(failed.error.code, "ENCODER_EXITED");

  const unchanged = store.getStream("stream-good");
  assert.equal(unchanged.state, STREAM_STATES.LIVE);
  assert.equal(unchanged.error, null);

  const listing = store.listStreams();
  assert.deepEqual(listing.active.map((stream) => stream.streamId), ["stream-good"]);
  assert.deepEqual(listing.recent.map((stream) => stream.streamId), ["stream-failed"]);
});

test("lists recently active stopped streams with a configurable limit", () => {
  const config = createTestConfig();
  const store = createStreamStore(config, { now: createClock() });

  store.createStream({ streamId: "stream-one" });
  store.createStream({ streamId: "stream-two" });
  store.createStream({ streamId: "stream-three" });

  store.markStopped("stream-one");
  store.markStopped("stream-two");
  store.markStopped("stream-three");

  const listing = store.listStreams({ recentLimit: 2 });

  assert.deepEqual(listing.active, []);
  assert.deepEqual(listing.recent.map((stream) => stream.streamId), [
    "stream-three",
    "stream-two",
  ]);
});

test("guards generated stream ID collisions", () => {
  const config = createTestConfig();
  const store = createStreamStore(config, {
    idGenerator: () => "stream-collision",
  });

  store.createStream();

  assert.throws(() => store.createStream(), /Could not generate a unique streamId/);
});
