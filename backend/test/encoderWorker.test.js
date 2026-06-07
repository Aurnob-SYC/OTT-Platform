"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const {
  HLS_PLAYLIST_SIZE,
  HLS_SEGMENT_SECONDS,
  MAX_STDERR_TAIL_LENGTH,
  appendToTail,
  buildEncoderInputUrl,
  buildFfmpegCommand,
  cleanupStreamOutputDirectory,
  createEncoderWorkerManager,
} = require("../src/encoderWorker");
const { createStreamStore } = require("../src/streams");

function createTestConfig() {
  return createRuntimeConfig(
    {
      FFMPEG_BINARY: "ffmpeg-test",
      HLS_MEDIA_ROOT: "media/live",
      LAN_HOST: "192.168.1.25",
      MEDIAMTX_RTSP_BASE_URL: "rtsp://127.0.0.1:8554",
    },
    {
      backendRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ott-encoder-")),
    },
  );
}

function createPublishedStream(config, streamId = "stream-alpha") {
  const store = createStreamStore(config);
  store.createStream({ streamId });
  return store.markPublishing(streamId);
}

function createFakeSpawn(calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + calls.length;
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

test("builds an FFmpeg command for RTSP input and per-stream HLS output", () => {
  const config = createTestConfig();
  const stream = createPublishedStream(config);
  const command = buildFfmpegCommand(config, stream);

  assert.equal(buildEncoderInputUrl(config, "stream-alpha"), "rtsp://127.0.0.1:8554/live/stream-alpha");
  assert.equal(command.command, "ffmpeg-test");
  assert.equal(command.inputUrl, "rtsp://127.0.0.1:8554/live/stream-alpha");
  assert.deepEqual(command.renditions, ["360p", "480p", "720p"]);
  assert.equal(command.args.includes("-rtsp_transport"), true);
  assert.equal(command.args.includes("libx264"), true);
  assert.equal(command.args.includes("aac"), true);
  assert.equal(command.args.includes(String(HLS_SEGMENT_SECONDS)), true);
  assert.equal(command.args.includes(String(HLS_PLAYLIST_SIZE)), true);
  assert.equal(command.args.includes(path.join(stream.output.hlsOutputDir, "360p", "index.m3u8")), true);
  assert.equal(command.args.includes(path.join(stream.output.hlsOutputDir, "480p", "index.m3u8")), true);
  assert.equal(command.args.includes(path.join(stream.output.hlsOutputDir, "720p", "index.m3u8")), true);
  assert.match(command.commandLine, /ffmpeg-test/);
});

test("starts isolated encoder workers and prepares only each stream output directory", () => {
  const config = createTestConfig();
  const store = createStreamStore(config);
  const calls = [];
  const manager = createEncoderWorkerManager(config, {
    now: () => "2026-01-01T00:00:00.000Z",
    spawn: createFakeSpawn(calls),
  });

  store.createStream({ streamId: "stream-alpha" });
  store.createStream({ streamId: "stream-beta" });

  const first = manager.startEncoder(store.markPublishing("stream-alpha"));
  const second = manager.startEncoder(store.markPublishing("stream-beta"));

  assert.equal(first.pid, 1000);
  assert.equal(second.pid, 1001);
  assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-alpha", "master.m3u8")), true);
  assert.equal(fs.existsSync(path.join(config.hls.mediaRoot, "stream-beta", "master.m3u8")), true);
  assert.equal(calls[0].args.includes(path.join(config.hls.mediaRoot, "stream-beta", "360p", "index.m3u8")), false);
  assert.equal(calls[1].args.includes(path.join(config.hls.mediaRoot, "stream-alpha", "360p", "index.m3u8")), false);

  calls[0].child.stderr.emit("data", Buffer.from("alpha stderr"));

  assert.equal(manager.getEncoderStatus("stream-alpha").stderrTail, "alpha stderr");
  assert.equal(manager.getEncoderStatus("stream-beta").stderrTail, "");

  const stopped = manager.stopEncoder("stream-alpha");

  assert.equal(stopped.state, "stopped");
  assert.equal(calls[0].child.killedSignal, "SIGTERM");
  assert.equal(manager.getEncoderStatus("stream-beta").running, true);
});

test("keeps encoder stderr tails bounded to the newest output", () => {
  const longChunk = "x".repeat(MAX_STDERR_TAIL_LENGTH + 20);
  const tail = appendToTail("old output", longChunk);

  assert.equal(tail.length, MAX_STDERR_TAIL_LENGTH);
  assert.equal(tail, longChunk.slice(20));
  assert.equal(tail.includes("old output"), false);
});

test("cleans only the failed stream output directory after validating the target path", () => {
  const config = createTestConfig();
  const store = createStreamStore(config);

  store.createStream({ streamId: "stream-alpha" });
  store.createStream({ streamId: "stream-beta" });

  const alpha = store.getStream("stream-alpha");
  const beta = store.getStream("stream-beta");

  fs.mkdirSync(path.join(alpha.output.hlsOutputDir, "360p"), { recursive: true });
  fs.mkdirSync(path.join(beta.output.hlsOutputDir, "360p"), { recursive: true });
  fs.writeFileSync(path.join(alpha.output.hlsOutputDir, "master.m3u8"), "#EXTM3U\n");
  fs.writeFileSync(path.join(alpha.output.hlsOutputDir, "360p", "index.m3u8"), "#EXTM3U\n");
  fs.writeFileSync(path.join(beta.output.hlsOutputDir, "master.m3u8"), "#EXTM3U\n");

  const cleanup = cleanupStreamOutputDirectory(config, "stream-alpha", alpha.output.hlsOutputDir);

  assert.equal(cleanup.attempted, true);
  assert.deepEqual(cleanup.errors, []);
  assert.equal(fs.existsSync(alpha.output.hlsOutputDir), true);
  assert.equal(fs.existsSync(path.join(alpha.output.hlsOutputDir, "master.m3u8")), false);
  assert.equal(fs.existsSync(path.join(alpha.output.hlsOutputDir, "360p")), false);
  assert.equal(fs.existsSync(path.join(beta.output.hlsOutputDir, "master.m3u8")), true);

  assert.throws(
    () => cleanupStreamOutputDirectory(config, "stream-alpha", beta.output.hlsOutputDir),
    /Cleanup output directory must match stream stream-alpha's HLS directory/,
  );
});
