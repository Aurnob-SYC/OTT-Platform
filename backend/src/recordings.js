"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { assertStreamId } = require("./urlBuilders");
const {
  assertRecordingId,
  buildRecordingArchivePath,
  buildRecordingPlaybackUrl,
  buildRecordingVodOutputDir,
} = require("./recordingPaths");

const RECORDING_STATES = Object.freeze({
  RECORDING: "recording",
  FINALIZING: "finalizing",
  PACKAGING: "packaging",
  PACKAGED: "packaged",
  FAILED: "failed",
  DELETING: "deleting",
  DELETED: "deleted",
});

const VISIBLE_RECORDING_STATES = new Set([
  RECORDING_STATES.RECORDING,
  RECORDING_STATES.FINALIZING,
  RECORDING_STATES.PACKAGING,
  RECORDING_STATES.PACKAGED,
  RECORDING_STATES.FAILED,
]);

const DEFAULT_LIST_LIMIT = 50;
const MAX_GENERATE_ATTEMPTS = 10;

/**
 * Returns the current time in ISO-8601 format.
 * @returns {string} The current timestamp string.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Generates a new opaque recording identifier for one source stream.
 * @param {string} sourceStreamId - Source live stream identifier.
 * @param {() => string} [getNow=nowIso] - Clock used for deterministic tests.
 * @returns {string} A unique-looking recording id prefixed with `rec-`.
 */
function generateRecordingId(sourceStreamId, getNow = nowIso) {
  assertStreamId(sourceStreamId);

  const date = getNow().slice(0, 10).replace(/-/g, "");
  const suffix = crypto.randomBytes(6).toString("hex");
  return `rec-${date}-${sourceStreamId}-${suffix}`;
}

/**
 * Validates that a value is one of the known recording states.
 * @param {string} state - Recording state to check.
 * @returns {void}
 */
function assertKnownRecordingState(state) {
  if (!Object.values(RECORDING_STATES).includes(state)) {
    throw new Error(`Unknown recording state: ${state}`);
  }
}

/**
 * Normalizes a recording title into a non-empty user-facing label.
 * @param {unknown} title - Title value supplied by the caller.
 * @returns {string} A trimmed title or the default label when empty.
 */
function normalizeTitle(title) {
  if (title === undefined || title === null) {
    return "Untitled recording";
  }

  const value = String(title).trim();
  return value === "" ? "Untitled recording" : value;
}

/**
 * Deep-clones a JSON-compatible value.
 * @param {unknown} value - Value to duplicate.
 * @returns {unknown} A deep copy created through JSON serialization.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Sorts recording records by newest creation time first.
 * @param {{createdAt: string}} left - Left-hand record.
 * @param {{createdAt: string}} right - Right-hand record.
 * @returns {number} Comparison value suitable for `Array.prototype.sort`.
 */
function sortByCreatedAtDescending(left, right) {
  return right.createdAt.localeCompare(left.createdAt);
}

/**
 * Converts an internal recording record into the public metadata shape.
 * @param {object} record - Internal recording record stored by the recording store.
 * @returns {object} A serializable recording metadata object.
 */
function toRecordingMetadata(record) {
  return clone(record);
}

/**
 * Builds a new internal recording record.
 * @param {object} config - Runtime configuration used to derive paths and URLs.
 * @param {object} input - Recording creation input containing ids and optional metadata.
 * @param {string} timestamp - Timestamp used for all initial record fields.
 * @returns {object} A new internal recording record.
 */
function createRecordingRecord(config, input, timestamp) {
  return {
    recordingId: input.recordingId,
    sourceStreamId: input.sourceStreamId,
    title: normalizeTitle(input.title),
    state: RECORDING_STATES.RECORDING,
    visible: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    finalizingAt: null,
    packagingStartedAt: null,
    packagedAt: null,
    failedAt: null,
    deletingAt: null,
    deletedAt: null,
    archivePath: buildRecordingArchivePath(config, input.recordingId),
    vodOutputPath: buildRecordingVodOutputDir(config, input.recordingId),
    playbackUrl: buildRecordingPlaybackUrl(config, input.recordingId),
    durationSeconds: null,
    error: null,
  };
}

/**
 * Creates an in-memory recording store with JSON metadata persistence.
 * @param {object} config - Runtime configuration used to derive recording paths.
 * @param {object} [options={}] - Optional hooks for id generation, clock control, and filesystem IO.
 * @returns {object} A store with CRUD-style helpers for recording metadata.
 */
function createRecordingStore(config, options = {}) {
  const records = new Map();
  const idGenerator = options.idGenerator || ((sourceStreamId) => generateRecordingId(sourceStreamId, getNow));
  const getNow = options.now || nowIso;
  const metadataPath = options.metadataPath || config.recordings.metadataPath;
  const persist = options.persist !== false;

  /**
   * Writes the current metadata snapshot to disk.
   * @returns {void}
   */
  function saveToDisk() {
    if (!persist) {
      return;
    }

    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    const payload = {
      version: 1,
      recordings: Array.from(records.values()).map(toRecordingMetadata),
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  /**
   * Loads any existing metadata snapshot into memory.
   * @returns {void}
   */
  function loadFromDisk() {
    if (!persist || !fs.existsSync(metadataPath)) {
      return;
    }

    const payload = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const loadedRecords = Array.isArray(payload) ? payload : payload.recordings;

    if (!Array.isArray(loadedRecords)) {
      throw new Error("Recording metadata file must contain a recordings array.");
    }

    records.clear();
    for (const record of loadedRecords) {
      assertRecordingId(record.recordingId);
      assertStreamId(record.sourceStreamId);
      assertKnownRecordingState(record.state);
      records.set(record.recordingId, {
        ...record,
        archivePath: buildRecordingArchivePath(config, record.recordingId),
        vodOutputPath: buildRecordingVodOutputDir(config, record.recordingId),
        playbackUrl: buildRecordingPlaybackUrl(config, record.recordingId),
        visible: record.visible !== false && record.state !== RECORDING_STATES.DELETED,
        error: record.error || null,
      });
    }
  }

  /**
   * Looks up a recording record and throws if the id is missing or unknown.
   * @param {string} recordingId - Recording identifier to load.
   * @returns {object} The internal recording record.
   */
  function requireRecording(recordingId) {
    assertRecordingId(recordingId);

    const record = records.get(recordingId);
    if (!record) {
      throw new Error(`Recording not found: ${recordingId}`);
    }

    return record;
  }

  /**
   * Creates a recording metadata record without starting media jobs.
   * @param {object} input - Recording creation input such as `sourceStreamId`, `recordingId`, and `title`.
   * @returns {object} The public metadata for the newly created recording.
   */
  function createRecording(input) {
    assertStreamId(input.sourceStreamId);

    let recordingId = input.recordingId;
    if (recordingId !== undefined) {
      assertRecordingId(recordingId);
      if (records.has(recordingId)) {
        throw new Error(`Recording already exists: ${recordingId}`);
      }
    } else {
      for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
        const candidate = idGenerator(input.sourceStreamId);
        assertRecordingId(candidate);

        if (!records.has(candidate)) {
          recordingId = candidate;
          break;
        }
      }

      if (!recordingId) {
        throw new Error("Could not generate a unique recordingId.");
      }
    }

    const timestamp = getNow();
    const record = createRecordingRecord(config, { ...input, recordingId }, timestamp);
    records.set(recordingId, record);
    saveToDisk();

    return toRecordingMetadata(record);
  }

  /**
   * Returns the current public metadata for one recording.
   * @param {string} recordingId - Recording identifier to load.
   * @returns {object} The public recording metadata.
   */
  function getRecording(recordingId) {
    return toRecordingMetadata(requireRecording(recordingId));
  }

  /**
   * Applies a mutation to a recording record and persists the changed metadata.
   * @param {string} recordingId - Recording identifier to modify.
   * @param {(record: object) => void} updater - Mutation callback that edits the internal record.
   * @returns {object} The updated public recording metadata.
   */
  function updateRecording(recordingId, updater) {
    const record = requireRecording(recordingId);
    updater(record);
    record.updatedAt = getNow();
    saveToDisk();
    return toRecordingMetadata(record);
  }

  /**
   * Changes a recording's lifecycle state while merging optional metadata details.
   * @param {string} recordingId - Recording identifier to update.
   * @param {string} state - New lifecycle state.
   * @param {object} [details={}] - Extra fields to merge into the record.
   * @returns {object} The updated public recording metadata.
   */
  function setRecordingState(recordingId, state, details = {}) {
    assertKnownRecordingState(state);

    return updateRecording(recordingId, (record) => {
      record.state = state;

      if (details.title !== undefined) record.title = normalizeTitle(details.title);
      if (details.durationSeconds !== undefined) record.durationSeconds = details.durationSeconds;
      if (details.error !== undefined) record.error = details.error;

      const timestamp = getNow();
      if (state === RECORDING_STATES.FINALIZING) record.finalizingAt = timestamp;
      if (state === RECORDING_STATES.PACKAGING) record.packagingStartedAt = timestamp;
      if (state === RECORDING_STATES.PACKAGED) {
        record.packagedAt = timestamp;
        record.error = details.error === undefined ? null : details.error;
      }
      if (state === RECORDING_STATES.FAILED) {
        record.failedAt = timestamp;
        record.error = details.error || { message: "Recording failed." };
      }
      if (state === RECORDING_STATES.DELETING) record.deletingAt = timestamp;
      if (state === RECORDING_STATES.DELETED) {
        record.deletedAt = timestamp;
        record.visible = false;
      }
    });
  }

  /**
   * Lists recordings in newest-first order.
   * @param {object} [optionsForList={}] - Options controlling visibility and count.
   * @returns {object[]} Sorted recording metadata records.
   */
  function listRecordings(optionsForList = {}) {
    const includeHidden = optionsForList.includeHidden === true;
    const states = optionsForList.states ? new Set(optionsForList.states) : null;
    const limit = optionsForList.limit || DEFAULT_LIST_LIMIT;

    return Array.from(records.values())
      .filter((record) => includeHidden || record.visible !== false)
      .filter((record) => !states || states.has(record.state))
      .filter((record) => includeHidden || VISIBLE_RECORDING_STATES.has(record.state))
      .sort(sortByCreatedAtDescending)
      .slice(0, limit)
      .map(toRecordingMetadata);
  }

  /**
   * Hides a recording from normal user-facing lists without deleting files.
   * @param {string} recordingId - Recording identifier to hide.
   * @returns {object} The hidden recording metadata.
   */
  function hideRecording(recordingId) {
    return updateRecording(recordingId, (record) => {
      record.visible = false;
      if (record.state !== RECORDING_STATES.DELETED) {
        record.state = RECORDING_STATES.DELETED;
        record.deletedAt = getNow();
      }
    });
  }

  /**
   * Removes every recording record from the store and writes an empty metadata file.
   * @returns {void}
   */
  function clear() {
    records.clear();
    saveToDisk();
  }

  loadFromDisk();

  return {
    clear,
    createRecording,
    getRecording,
    hideRecording,
    listRecordings,
    loadFromDisk,
    saveToDisk,
    setRecordingState,
    updateRecording,
  };
}

module.exports = {
  RECORDING_STATES,
  VISIBLE_RECORDING_STATES,
  createRecordingStore,
  generateRecordingId,
  toRecordingMetadata,
};
