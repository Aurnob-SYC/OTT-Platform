"use strict";

const crypto = require("node:crypto");

const { createInitialHlsReadiness } = require("./hlsReadiness");
const { assertStreamId, buildStreamUrls } = require("./urlBuilders");

const STREAM_STATES = Object.freeze({
  CREATED: "created",
  PUBLISHING: "publishing",
  ENCODING: "encoding",
  LIVE: "live",
  STOPPED: "stopped",
  FAILED: "failed",
});

const ACTIVE_STREAM_STATES = new Set([
  STREAM_STATES.CREATED,
  STREAM_STATES.PUBLISHING,
  STREAM_STATES.ENCODING,
  STREAM_STATES.LIVE,
]);

const TERMINAL_STREAM_STATES = new Set([
  STREAM_STATES.STOPPED,
  STREAM_STATES.FAILED,
]);

const DEFAULT_RECENT_LIMIT = 20;
const MAX_GENERATE_ATTEMPTS = 10;

/**
 * Returns the current time in ISO-8601 format.
 * @returns {string} The current timestamp string.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Generates a new opaque stream identifier.
 * @returns {string} A unique stream id string prefixed with `stream-`.
 */
function generateStreamId() {
  return `stream-${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Validates that a value is one of the known stream states.
 * @param {string} state - Stream state to check.
 * @returns {void}
 */
function assertKnownState(state) {
  if (!Object.values(STREAM_STATES).includes(state)) {
    throw new Error(`Unknown stream state: ${state}`);
  }
}

/**
 * Normalizes a stream title into a non-empty user-facing label.
 * @param {unknown} title - Title value supplied by the caller.
 * @returns {string} A trimmed title or the default label when empty.
 */
function normalizeTitle(title) {
  if (title === undefined || title === null) {
    return "Untitled stream";
  }

  const value = String(title).trim();
  return value === "" ? "Untitled stream" : value;
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
 * Sorts stream records by most recently updated first.
 * @param {{updatedAt: string}} left - Left-hand record.
 * @param {{updatedAt: string}} right - Right-hand record.
 * @returns {number} Comparison value suitable for `Array.prototype.sort`.
 */
function sortByUpdatedAtDescending(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

/**
 * Builds the default encoder state used when a stream is first created.
 * @returns {object} A fresh idle encoder status object.
 */
function createInitialEncoderStatus() {
  return {
    state: "idle",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    exitCode: null,
    exitSignal: null,
    stderrTail: "",
    inputUrl: null,
    outputDir: null,
    renditions: [],
    commandLine: null,
    running: false,
  };
}

/**
 * Builds the internal stream record stored by the stream store.
 * @param {object} config - Runtime configuration used to derive stream URLs and output paths.
 * @param {object} input - Stream creation input containing ids and optional metadata.
 * @param {string} timestamp - Timestamp used for all initial record fields.
 * @returns {object} A new internal stream record.
 */
function createStreamRecord(config, input, timestamp) {
  const streamUrls = buildStreamUrls(config, input.streamId);

  return {
    streamId: input.streamId,
    title: normalizeTitle(input.title),
    publisher: {
      userId: input.publisherUserId || null,
    },
    state: STREAM_STATES.CREATED,
    mediaMtxPath: streamUrls.publishPath,
    publishUrl: streamUrls.publishUrl,
    whipUrl: streamUrls.whipUrl,
    playbackUrl: streamUrls.playbackUrl,
    hlsOutputDir: streamUrls.hlsOutputDir,
    outputReadiness: createInitialHlsReadiness(streamUrls.hlsOutputDir),
    encoder: createInitialEncoderStatus(),
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishingStartedAt: null,
    encodingStartedAt: null,
    liveAt: null,
    stoppedAt: null,
    failedAt: null,
  };
}

/**
 * Converts an internal stream record into the public API status shape.
 * @param {object} record - Internal stream record stored by the stream store.
 * @returns {object} A serializable stream status object for API responses.
 */
function toStreamStatus(record) {
  return {
    streamId: record.streamId,
    title: record.title,
    state: record.state,
    publisher: clone(record.publisher),
    relay: {
      mediaMtxPath: record.mediaMtxPath,
      publishUrl: record.publishUrl,
      whipUrl: record.whipUrl,
    },
    output: {
      hlsOutputDir: record.hlsOutputDir,
      playbackUrl: record.playbackUrl,
      readiness: clone(record.outputReadiness),
    },
    encoder: clone(record.encoder),
    error: record.error ? clone(record.error) : null,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      publishingStartedAt: record.publishingStartedAt,
      encodingStartedAt: record.encodingStartedAt,
      liveAt: record.liveAt,
      stoppedAt: record.stoppedAt,
      failedAt: record.failedAt,
    },
  };
}

/**
 * Creates an in-memory stream store for the current backend runtime.
 * @param {object} config - Runtime configuration used to derive stream URLs and paths.
 * @param {object} [options={}] - Optional hooks for id generation and clock control.
 * @returns {object} A store with CRUD-style helpers for stream lifecycle management.
 */
function createStreamStore(config, options = {}) {
  const records = new Map();
  const idGenerator = options.idGenerator || generateStreamId;
  const getNow = options.now || nowIso;

  /**
   * Looks up a stream record and throws if the id is missing or unknown.
   * @param {string} streamId - Stream identifier to load.
   * @returns {object} The internal stream record.
   */
  function requireStream(streamId) {
    assertStreamId(streamId);

    const record = records.get(streamId);
    if (!record) {
      throw new Error(`Stream not found: ${streamId}`);
    }

    return record;
  }

  /**
   * Creates a new stream record and stores it in memory.
   * @param {object} [input={}] - Optional creation input such as `streamId`, `title`, and `publisherUserId`.
   * @returns {object} The public stream status for the newly created stream.
   */
  function createStream(input = {}) {
    let streamId = input.streamId;

    if (streamId !== undefined) {
      assertStreamId(streamId);
      if (records.has(streamId)) {
        throw new Error(`Stream already exists: ${streamId}`);
      }
    } else {
      for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
        const candidate = idGenerator();
        assertStreamId(candidate);

        if (!records.has(candidate)) {
          streamId = candidate;
          break;
        }
      }

      if (!streamId) {
        throw new Error("Could not generate a unique streamId.");
      }
    }

    const timestamp = getNow();
    const record = createStreamRecord(config, { ...input, streamId }, timestamp);
    records.set(streamId, record);

    return toStreamStatus(record);
  }

  /**
   * Returns the current public status for one stream.
   * @param {string} streamId - Stream identifier to load.
   * @returns {object} The public stream status.
   */
  function getStream(streamId) {
    return toStreamStatus(requireStream(streamId));
  }

  /**
   * Checks whether a stream exists in the store.
   * @param {string} streamId - Stream identifier to test.
   * @returns {boolean} True when the stream record exists.
   */
  function hasStream(streamId) {
    assertStreamId(streamId);
    return records.has(streamId);
  }

  /**
   * Applies a mutation to a stream record and refreshes its `updatedAt` timestamp.
   * @param {string} streamId - Stream identifier to modify.
   * @param {(record: object) => void} updater - Mutation callback that edits the internal record.
   * @returns {object} The updated public stream status.
   */
  function updateStream(streamId, updater) {
    const record = requireStream(streamId);
    updater(record);
    record.updatedAt = getNow();
    return toStreamStatus(record);
  }

  /**
   * Changes a stream's lifecycle state while merging optional status details.
   * @param {string} streamId - Stream identifier to update.
   * @param {string} state - New lifecycle state.
   * @param {object} [details={}] - Extra fields to merge into the record, such as encoder or error data.
   * @returns {object} The updated public stream status.
   */
  function setStreamState(streamId, state, details = {}) {
    assertKnownState(state);

    return updateStream(streamId, (record) => {
      record.state = state;

      if (details.publisherUserId !== undefined) {
        record.publisher.userId = details.publisherUserId;
      }

      if (details.encoder !== undefined) {
        record.encoder = {
          ...record.encoder,
          ...details.encoder,
        };
      }

      if (details.outputReadiness !== undefined) {
        record.outputReadiness = clone(details.outputReadiness);
      }

      if (details.error !== undefined) {
        record.error = details.error;
      }

      const timestamp = getNow();
      if (state === STREAM_STATES.PUBLISHING) record.publishingStartedAt = timestamp;
      if (state === STREAM_STATES.ENCODING) record.encodingStartedAt = timestamp;
      if (state === STREAM_STATES.LIVE) record.liveAt = timestamp;
      if (state === STREAM_STATES.STOPPED) record.stoppedAt = timestamp;
      if (state === STREAM_STATES.FAILED) record.failedAt = timestamp;
    });
  }

  /**
   * Marks a stream as publishing.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} [details={}] - Optional publisher metadata to store alongside the state change.
   * @returns {object} The updated public stream status.
   */
  function markPublishing(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.PUBLISHING, details);
  }

  /**
   * Marks a stream as encoding and records the encoder start timestamp.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} [details={}] - Optional encoder metadata to merge into the record.
   * @returns {object} The updated public stream status.
   */
  function markEncoding(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.ENCODING, {
      ...details,
      encoder: {
        state: STREAM_STATES.ENCODING,
        startedAt: getNow(),
        ...(details.encoder || {}),
      },
      error: details.error === undefined ? null : details.error,
    });
  }

  /**
   * Marks a stream as live.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} [details={}] - Optional output readiness or encoder metadata to merge.
   * @returns {object} The updated public stream status.
   */
  function markLive(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.LIVE, details);
  }

  /**
   * Replaces the stored HLS readiness report without changing the stream state.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} outputReadiness - New HLS readiness object.
   * @returns {object} The updated public stream status.
   */
  function updateOutputReadiness(streamId, outputReadiness) {
    const record = requireStream(streamId);
    record.outputReadiness = clone(outputReadiness);
    return toStreamStatus(record);
  }

  /**
   * Marks a stream as stopped and stores encoder shutdown details.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} [details={}] - Optional encoder or error metadata to merge into the record.
   * @returns {object} The updated public stream status.
   */
  function markStopped(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.STOPPED, {
      ...details,
      encoder: {
        state: STREAM_STATES.STOPPED,
        stoppedAt: getNow(),
        ...(details.encoder || {}),
      },
      error: details.error === undefined ? null : details.error,
    });
  }

  /**
   * Marks a stream as failed and stores the failure details.
   * @param {string} streamId - Stream identifier to update.
   * @param {object} [details={}] - Optional encoder or error metadata to merge into the record.
   * @returns {object} The updated public stream status.
   */
  function markFailed(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.FAILED, {
      ...details,
      encoder: {
        state: STREAM_STATES.FAILED,
        stoppedAt: getNow(),
        ...(details.encoder || {}),
      },
      error: details.error || {
        message: "Stream failed.",
      },
    });
  }

  /**
   * Lists active streams and optionally recent terminal streams.
   * @param {object} [optionsForList={}] - Options that control recent-stream inclusion and count.
   * @returns {{active: object[], recent: object[]}} Sorted active and recent stream lists.
   */
  function listStreams(optionsForList = {}) {
    const includeRecentlyActive = optionsForList.includeRecentlyActive !== false;
    const recentLimit = optionsForList.recentLimit || DEFAULT_RECENT_LIMIT;
    const sortedRecords = Array.from(records.values()).sort(sortByUpdatedAtDescending);
    const active = sortedRecords
      .filter((record) => ACTIVE_STREAM_STATES.has(record.state))
      .map(toStreamStatus);

    if (!includeRecentlyActive) {
      return {
        active,
        recent: [],
      };
    }

    const recent = sortedRecords
      .filter((record) => TERMINAL_STREAM_STATES.has(record.state))
      .slice(0, recentLimit)
      .map(toStreamStatus);

    return {
      active,
      recent,
    };
  }

  /**
   * Removes every stream record from the store.
   * @returns {void}
   */
  function clear() {
    records.clear();
  }

  return {
    clear,
    createStream,
    getStream,
    hasStream,
    listStreams,
    markEncoding,
    markFailed,
    markLive,
    markPublishing,
    markStopped,
    setStreamState,
    updateOutputReadiness,
  };
}

module.exports = {
  ACTIVE_STREAM_STATES,
  STREAM_STATES,
  TERMINAL_STREAM_STATES,
  createStreamStore,
  generateStreamId,
  toStreamStatus,
};
