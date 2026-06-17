"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const { buildRecordingArchivePath } = require("../src/recordingPaths");
const {
  buildVodPackagingCommand,
  computeMidrollOffsetSeconds,
  createVodPackagerManager,
} = require("../src/vodPackager");

function createTestConfig() {
  return createRuntimeConfig(
    {
      FFPROBE_BINARY: "ffprobe-test",
      FFMPEG_BINARY: "ffmpeg-test",
      LAN_HOST: "192.168.1.25",
      PREROLL_SOURCE_PATH: "media/ads/preroll/source.mp4",
      RECORDING_ARCHIVE_ROOT: "media/archive",
      VOD_MEDIA_ROOT: "media/vod",
    },
    {
      backendRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ott-vod-packager-")),
    },
  );
}

function createRecording(config, recordingId = "rec-20260612-stream-alpha") {
  return {
    archivePath: buildRecordingArchivePath(config, recordingId),
    recordingId,
    vodOutputPath: path.join(config.recordings.vodRoot, recordingId),
  };
}

function createFakeSpawn(calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 9000 + calls.length;

    calls.push({
      args,
      child,
      command,
      options,
    });

    return child;
  };
}

function writeNonEmptyFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "media");
}

test("builds a VOD packaging command that reads pre-roll and archive sources", () => {
  const config = createTestConfig();
  const recording = createRecording(config);
  const command = buildVodPackagingCommand(config, recording, {
    archiveDurationSeconds: 120,
    renditions: ["360p", "480p"],
  });

  assert.equal(command.command, "ffmpeg-test");
  assert.equal(command.recordingId, "rec-20260612-stream-alpha");
  assert.equal(command.archiveDurationSeconds, 120);
  assert.equal(command.midrollOffsetSeconds, 60);
  assert.equal(command.prerollPath, config.recordings.prerollSourcePath);
  assert.equal(command.archivePath, recording.archivePath);
  assert.deepEqual(command.renditions, ["360p", "480p"]);
  assert.equal(command.args.includes(config.recordings.prerollSourcePath), true);
  assert.equal(command.args.includes(recording.archivePath), true);
  assert.equal(command.args.includes("-hls_playlist_type"), true);
  assert.equal(command.args.includes("vod"), true);
  assert.equal(command.args.includes(path.join(command.outputDir, "360p", "index.m3u8")), true);
  assert.equal(command.args.includes(path.join(command.outputDir, "480p", "index.m3u8")), true);
  assert.match(command.args.join(" "), /trim=end=60/);
  assert.match(command.args.join(" "), /trim=start=60/);
  assert.match(command.args.join(" "), /atrim=end=60/);
  assert.match(command.args.join(" "), /atrim=start=60/);
  assert.match(command.args.join(" "), /split=2\[vpre\]\[vmid\]/);
  assert.match(command.args.join(" "), /asplit=2\[apre\]\[amid\]/);
  assert.match(command.args.join(" "), /concat=n=4:v=1:a=1/);
  assert.match(command.commandLine, /ffmpeg-test/);
});

test("computes a midpoint ad offset while keeping short recordings usable", () => {
  assert.equal(computeMidrollOffsetSeconds(120), 60);
  assert.equal(computeMidrollOffsetSeconds(3), 1.5);
  assert.throws(
    () => computeMidrollOffsetSeconds(0),
    /Recording archive duration must be a positive number/,
  );
});

test("starts one packaging worker after validating archive and pre-roll inputs", () => {
  const config = createTestConfig();
  const recording = createRecording(config);
  const calls = [];
  const exitEvents = [];
  const manager = createVodPackagerManager(config, {
    now: () => "2026-06-12T10:00:00.000Z",
    onPackagingExit: (event) => exitEvents.push(event),
    probeArchiveDurationSeconds: () => 90,
    spawn: createFakeSpawn(calls),
  });

  writeNonEmptyFile(recording.archivePath);
  writeNonEmptyFile(config.recordings.prerollSourcePath);
  fs.mkdirSync(path.join(recording.vodOutputPath, "old"), { recursive: true });

  const status = manager.startPackaging(recording, {
    renditions: ["360p"],
  });

  assert.equal(status.pid, 9000);
  assert.equal(status.running, true);
  assert.equal(status.recordingId, recording.recordingId);
  assert.equal(status.archiveDurationSeconds, 90);
  assert.equal(status.midrollOffsetSeconds, 45);
  assert.deepEqual(status.renditions, ["360p"]);
  assert.equal(fs.existsSync(path.join(recording.vodOutputPath, "old")), false);
  assert.equal(fs.existsSync(path.join(recording.vodOutputPath, "master.m3u8")), true);
  assert.equal(fs.existsSync(path.join(recording.vodOutputPath, "360p")), true);
  assert.equal(calls.length, 1);

  calls[0].child.stderr.emit("data", Buffer.from("packaging output"));
  calls[0].child.emit("close", 0, null);

  assert.equal(exitEvents.length, 1);
  assert.equal(exitEvents[0].exitCode, 0);
  assert.equal(exitEvents[0].archiveDurationSeconds, 90);
  assert.equal(exitEvents[0].midrollOffsetSeconds, 45);
  assert.equal(exitEvents[0].stderrTail, "packaging output");
  assert.equal(manager.getPackagingStatus(recording.recordingId), null);
});

test("fails clearly before spawning when the shared pre-roll source is missing", () => {
  const config = createTestConfig();
  const recording = createRecording(config);
  const calls = [];
  const manager = createVodPackagerManager(config, {
    probeArchiveDurationSeconds: () => 90,
    spawn: createFakeSpawn(calls),
  });

  writeNonEmptyFile(recording.archivePath);

  assert.throws(
    () => manager.startPackaging(recording),
    /Pre-roll source clip is missing/,
  );
  assert.equal(calls.length, 0);
});

test("fails clearly before spawning when archive duration probing fails", () => {
  const config = createTestConfig();
  const recording = createRecording(config);
  const calls = [];
  const manager = createVodPackagerManager(config, {
    probeArchiveDurationSeconds: () => {
      const error = new Error("probe failed");
      error.code = "ARCHIVE_DURATION_PROBE_FAILED";
      throw error;
    },
    spawn: createFakeSpawn(calls),
  });

  writeNonEmptyFile(recording.archivePath);
  writeNonEmptyFile(config.recordings.prerollSourcePath);

  assert.throws(() => manager.startPackaging(recording), /probe failed/);
  assert.equal(calls.length, 0);
});
