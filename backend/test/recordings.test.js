"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const {
  RECORDING_STATES,
  createRecordingStore,
  generateRecordingId,
} = require("../src/recordings");

function createTestConfig() {
  return createRuntimeConfig(
    {
      LAN_HOST: "192.168.1.25",
      RECORDING_ARCHIVE_ROOT: "media/archive",
      VOD_MEDIA_ROOT: "media/vod",
    },
    {
      backendRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ott-recording-store-test-")),
    },
  );
}

function createClock() {
  let tick = 0;

  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 5, 12, 10, 0, tick)).toISOString();
  };
}

test("creates recording metadata with derived archive, VOD, and playback locations", () => {
  const config = createTestConfig();
  const store = createRecordingStore(config, {
    idGenerator: () => "rec-20260612-stream-alpha",
    now: createClock(),
    persist: false,
  });

  const recording = store.createRecording({
    sourceStreamId: "stream-alpha",
    title: "Desk cam archive",
  });

  assert.equal(recording.recordingId, "rec-20260612-stream-alpha");
  assert.equal(recording.sourceStreamId, "stream-alpha");
  assert.equal(recording.title, "Desk cam archive");
  assert.equal(recording.state, RECORDING_STATES.RECORDING);
  assert.equal(recording.visible, true);
  assert.match(recording.archivePath, /media[\\/]archive[\\/]rec-20260612-stream-alpha[\\/]source\.mkv$/);
  assert.match(recording.vodOutputPath, /media[\\/]vod[\\/]rec-20260612-stream-alpha$/);
  assert.equal(
    recording.playbackUrl,
    "http://192.168.1.25/vod/rec-20260612-stream-alpha/master.m3u8",
  );
  assert.equal(recording.durationSeconds, null);
  assert.equal(recording.error, null);
});

test("updates recording state without changing unrelated records", () => {
  const config = createTestConfig();
  const store = createRecordingStore(config, {
    now: createClock(),
    persist: false,
  });

  store.createRecording({
    recordingId: "rec-one",
    sourceStreamId: "stream-one",
  });
  store.createRecording({
    recordingId: "rec-two",
    sourceStreamId: "stream-two",
  });

  const packaged = store.setRecordingState("rec-one", RECORDING_STATES.PACKAGED, {
    durationSeconds: 42,
  });
  const failed = store.setRecordingState("rec-two", RECORDING_STATES.FAILED, {
    error: {
      code: "ARCHIVE_EMPTY",
      message: "Archive file is empty.",
    },
  });

  assert.equal(packaged.state, RECORDING_STATES.PACKAGED);
  assert.equal(packaged.durationSeconds, 42);
  assert.equal(packaged.error, null);
  assert.equal(failed.state, RECORDING_STATES.FAILED);
  assert.equal(failed.error.code, "ARCHIVE_EMPTY");
});

test("lists visible recordings and hides deleted metadata", () => {
  const config = createTestConfig();
  const store = createRecordingStore(config, {
    now: createClock(),
    persist: false,
  });

  store.createRecording({
    recordingId: "rec-visible",
    sourceStreamId: "stream-visible",
  });
  store.createRecording({
    recordingId: "rec-hidden",
    sourceStreamId: "stream-hidden",
  });
  store.hideRecording("rec-hidden");

  assert.deepEqual(store.listRecordings().map((recording) => recording.recordingId), [
    "rec-visible",
  ]);
  assert.deepEqual(
    store.listRecordings({ includeHidden: true }).map((recording) => recording.recordingId),
    ["rec-hidden", "rec-visible"],
  );
  assert.equal(store.getRecording("rec-hidden").state, RECORDING_STATES.DELETED);
  assert.equal(store.getRecording("rec-hidden").visible, false);
});

test("persists recording metadata to JSON and reloads with backend-controlled paths", () => {
  const config = createTestConfig();
  const clock = createClock();

  const firstStore = createRecordingStore(config, {
    now: clock,
  });
  firstStore.createRecording({
    recordingId: "rec-persisted",
    sourceStreamId: "stream-persisted",
    title: "Persisted",
  });
  firstStore.setRecordingState("rec-persisted", RECORDING_STATES.PACKAGED, {
    durationSeconds: 12,
  });

  const rawMetadata = JSON.parse(fs.readFileSync(config.recordings.metadataPath, "utf8"));
  assert.equal(rawMetadata.version, 1);
  assert.equal(rawMetadata.recordings.length, 1);

  const secondStore = createRecordingStore(config, {
    now: clock,
  });
  const reloaded = secondStore.getRecording("rec-persisted");

  assert.equal(reloaded.title, "Persisted");
  assert.equal(reloaded.state, RECORDING_STATES.PACKAGED);
  assert.equal(reloaded.durationSeconds, 12);
  assert.match(reloaded.archivePath, /rec-persisted[\\/]source\.mkv$/);
  assert.match(reloaded.vodOutputPath, /rec-persisted$/);
});

test("rejects invalid IDs and generated recording ID collisions", () => {
  const config = createTestConfig();
  const store = createRecordingStore(config, {
    idGenerator: () => "rec-collision",
    persist: false,
  });

  assert.throws(
    () => store.createRecording({ recordingId: "../escape", sourceStreamId: "stream-ok" }),
    /recordingId must/,
  );
  assert.throws(
    () => store.createRecording({ recordingId: "rec-ok", sourceStreamId: "../escape" }),
    /streamId must/,
  );

  store.createRecording({
    sourceStreamId: "stream-one",
  });
  assert.throws(
    () =>
      store.createRecording({
        sourceStreamId: "stream-two",
      }),
    /Could not generate a unique recordingId/,
  );
});

test("generates recording IDs that include the date and source stream", () => {
  const generatedId = generateRecordingId(
    "stream-alpha",
    () => "2026-06-12T10:00:00.000Z",
  );

  assert.match(generatedId, /^rec-20260612-stream-alpha-[0-9a-f]{12}$/);
});
